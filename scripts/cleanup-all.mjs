import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAccessToken } from "./firebase-cli-auth.mjs";
const accessToken = await getAccessToken();
const base = "https://device-streaming-ded679cd-default-rtdb.asia-southeast1.firebasedatabase.app";
const res = await fetch(`${base}/.json?shallow=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
const keys = Object.keys(await res.json() || {});
console.log("total top-level:", keys.length);
let deleted = 0;
for (const k of keys) {
  if (k.startsWith("company-") && !["_"].includes(k)) {
    const r = await fetch(`${base}/${k}.json`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status === 200) { deleted++; console.log("deleted", k); }
    else console.log("delete failed", k, r.status);
  }
}
console.log("deleted", deleted);
process.exit(0);
