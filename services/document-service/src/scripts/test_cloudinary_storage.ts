import dotenv from "dotenv";
dotenv.config();

import cloudinary from "../config/cloudinary";
import fs from "fs";
import path from "path";

async function testCloudinaryStorage() {
  console.log("==========================================================");
  console.log("CLOUDINARY FILE STORAGE & ACCESS VERIFICATION");
  console.log("==========================================================");

  const testFilePath = path.join(__dirname, "cloudinary_test_sample.txt");
  fs.writeFileSync(testFilePath, "ResearchMind Cloudinary document storage verification payload.");

  try {
    // 1. Upload Test Document File to Cloudinary
    console.log("1. Uploading document file to Cloudinary (folder: 'researchmind/documents')...");
    const uploadResult = await cloudinary.uploader.upload(testFilePath, {
      folder: "researchmind/documents",
      resource_type: "raw",
      public_id: `test_doc_${Date.now()}`
    });

    console.log("   ✅ Upload Success!");
    console.log(`   Public ID  : ${uploadResult.public_id}`);
    console.log(`   Secure URL : ${uploadResult.secure_url}`);
    console.log(`   Bytes      : ${uploadResult.bytes}`);
    console.log(`   Format     : ${uploadResult.format || "raw"}`);

    // 2. Test HTTP Access to Cloudinary CDN URL
    console.log("\n2. Verifying HTTP accessibility of Cloudinary CDN URL...");
    const httpRes = await fetch(uploadResult.secure_url);
    const content = await httpRes.text();

    const isAccessible = httpRes.status === 200 && content.includes("ResearchMind Cloudinary");

    if (isAccessible) {
      console.log("   ✅ CDN HTTP Check: 200 OK!");
      console.log(`   Retrieved Payload: "${content.trim()}"`);
      console.log("\n==========================================================");
      console.log("✅ RESULT: DOCUMENTS ARE STORING & ACCESSIBLE PROPERLY ON CLOUDINARY!");
      console.log("==========================================================");
    } else {
      console.log("   ❌ CDN HTTP Check Failed:", httpRes.status);
    }

    // 3. Clean up test asset from Cloudinary
    console.log("\n3. Cleaning up test asset from Cloudinary...");
    await cloudinary.uploader.destroy(uploadResult.public_id, { resource_type: "raw" });
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    console.log("   ✅ Cleanup complete.");

    process.exit(isAccessible ? 0 : 1);
  } catch (err: any) {
    console.error("❌ Cloudinary Verification Error:", err.message);
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    process.exit(1);
  }
}

testCloudinaryStorage();
