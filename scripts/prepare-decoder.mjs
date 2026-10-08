import { copyFile, mkdir } from "node:fs/promises";
await mkdir("public/vendor", { recursive: true });
await copyFile("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", "public/vendor/zxing_reader.wasm");
console.log("Local QR decoder prepared; no CDN required.");
