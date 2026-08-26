import dotenv from "dotenv";
dotenv.config();

import { generateEmbeddings } from "../services/embedding.service";
import { upsertDocumentEmbeddings, deleteDocumentEmbeddings } from "../services/vector-service";
import { pineconeIndex } from "../config/pinecone";
import { voyageQueryEmbeddings } from "../config/voyage";

async function verifyVectorStorage() {
  console.log("==========================================================");
  console.log("PINECONE END-TO-END VECTOR DB VERIFICATION");
  console.log("==========================================================");

  const workspaceId = "ws_audit_verif_100";
  const documentId = "doc_audit_verif_100";
  const textChunk = "ResearchMind utilizes Pinecone vector database for high-dimensional semantic search and retrieval augmented generation.";

  try {
    // 1. Generate Voyage AI Embedding
    console.log("1. Generating 1024-dimensional Voyage AI embeddings...");
    const embeddings = await generateEmbeddings([textChunk]);
    console.log(`   Embeddings Generated: ${embeddings.length} vector(s), Dimension: ${embeddings[0].embedding.length}`);

    // 2. Upsert Vector to Pinecone Vector DB
    console.log(`2. Upserting vector into Pinecone (Namespace: '${workspaceId}', Doc: '${documentId}')...`);
    await upsertDocumentEmbeddings({
      documentId,
      workspaceId,
      uploadedBy: "user_audit_100",
      fileType: "pdf",
      chunks: [{ index: 0, text: textChunk }],
      embeddings
    });
    console.log("   ✅ Vector successfully stored in Pinecone!");

    // Wait 1.5 seconds for index sync
    await new Promise(r => setTimeout(r, 1500));

    // 3. Perform Vector Search / Query on Pinecone
    console.log("3. Performing semantic similarity search query in Pinecone...");
    const queryVector = await voyageQueryEmbeddings.embedQuery("What vector database does ResearchMind use?");
    
    const queryResult = await pineconeIndex.namespace(workspaceId).query({
      topK: 1,
      vector: queryVector,
      includeMetadata: true
    });

    const topMatch = queryResult.matches?.[0];
    const score = topMatch?.score ?? 0;
    const metadata = topMatch?.metadata as any;
    const isMatched = topMatch && metadata?.documentId === documentId && score > 0.6;

    if (isMatched) {
      console.log("\n==========================================================");
      console.log("✅ RESULT: VECTORS ARE STORING & MATCHING PERFECTLY IN PINECONE!");
      console.log("==========================================================");
      console.log(`Matched Vector ID: ${topMatch.id}`);
      console.log(`Similarity Score : ${(score * 100).toFixed(2)}%`);
      console.log(`Matched Metadata : Document = ${metadata.documentId}, Chunk = ${metadata.chunkIndex}`);
      console.log(`Extracted Text   : "${metadata.text}"`);
    } else {
      console.log("❌ RESULT: Vector query match failed or low score.");
      console.log(JSON.stringify(queryResult, null, 2));
    }

    // 4. Cleanup test vector from Pinecone
    console.log("\n4. Cleaning up test vector from Pinecone...");
    await deleteDocumentEmbeddings(workspaceId, documentId);
    console.log("   ✅ Test vector cleaned up from Pinecone.");

    process.exit(isMatched ? 0 : 1);
  } catch (err: any) {
    console.error("❌ Vector Storage Test Failed:", err.message);
    process.exit(1);
  }
}

verifyVectorStorage();
