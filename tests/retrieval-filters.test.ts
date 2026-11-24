import assert from "node:assert";
import { test, describe, before } from "node:test";
import { setTestSecrets } from "./helpers/test-env";

/*
 * UNIT: the pure match filter used by retrieval (ISS-027 model label,
 * ISS-028 relevance threshold) and the MIN_RELEVANCE_SCORE setting.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";

let retrieval: typeof import("../services/ai-service/src/services/retrieval.service");
let bounded: typeof import("../packages/shared/config/bounded-env");

before(async () => {
  retrieval = await import("../services/ai-service/src/services/retrieval.service");
  bounded = await import("../packages/shared/config/bounded-env");
});

const m = (score: number | undefined, embeddingModel?: string, text = "t") => ({
  score,
  metadata: embeddingModel === undefined ? { text } : { text, embeddingModel },
});

describe("selectUsableMatches (ai-service retrieval)", () => {
  test("ISS-027: matches labelled with another embedding model are dropped; unlabelled ones are kept", () => {
    const kept = retrieval.selectUsableMatches(
      [m(0.9, "voyage-3", "same"), m(0.95, "voyage-4", "other"), m(0.8, undefined, "legacy")],
      { model: "voyage-3", minScore: 0 }
    );
    assert.deepStrictEqual(kept.map((k) => k.metadata.text), ["same", "legacy"]);
  });

  test("ISS-028: matches below the threshold are dropped; equal to it are kept", () => {
    const kept = retrieval.selectUsableMatches(
      [m(0.19, "voyage-3", "low"), m(0.2, "voyage-3", "edge"), m(0.7, "voyage-3", "high")],
      { model: "voyage-3", minScore: 0.2 }
    );
    assert.deepStrictEqual(kept.map((k) => k.metadata.text), ["edge", "high"]);
  });

  test("all below the threshold gives an empty list", () => {
    assert.deepStrictEqual(
      retrieval.selectUsableMatches([m(0.1, "voyage-3"), m(0.05, "voyage-3")], { model: "voyage-3", minScore: 0.2 }),
      []
    );
  });

  test("matches without a score or metadata are dropped", () => {
    const kept = retrieval.selectUsableMatches(
      [m(undefined, "voyage-3"), { score: 0.9, metadata: null }, m(0.9, "voyage-3", "ok")] as any[],
      { model: "voyage-3", minScore: 0 }
    );
    assert.deepStrictEqual(kept.map((k: any) => k.metadata.text), ["ok"]);
  });
});

describe("MIN_RELEVANCE_SCORE", () => {
  test("default is 0.2 when unset", () => {
    const saved = process.env.MIN_RELEVANCE_SCORE;
    delete process.env.MIN_RELEVANCE_SCORE;
    try {
      assert.strictEqual(retrieval.DEFAULT_MIN_RELEVANCE_SCORE, 0.2);
      assert.strictEqual(retrieval.minRelevanceScore(), 0.2);
    } finally {
      if (saved !== undefined) process.env.MIN_RELEVANCE_SCORE = saved;
    }
  });

  test("a valid value is used; an invalid or out-of-range value falls back to the default", () => {
    const parse = (raw: string) => bounded.parseBoundedFloat(raw, 0.2, 0, 1);
    assert.deepStrictEqual(parse("0.35"), { value: 0.35, valid: true });
    assert.deepStrictEqual(parse("0"), { value: 0, valid: true });
    assert.deepStrictEqual(parse(".5"), { value: 0.5, valid: true });
    for (const bad of ["abc", "1.5", "-0.1", "0.3x", "NaN", "Infinity"]) {
      assert.deepStrictEqual(parse(bad), { value: 0.2, valid: false }, bad);
    }
    const env = { MIN_RELEVANCE_SCORE_TEST_ONLY: "high" };
    assert.strictEqual(bounded.readBoundedFloatEnv("MIN_RELEVANCE_SCORE_TEST_ONLY", 0.2, 0, 1, env), 0.2);
  });
});
