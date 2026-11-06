import express from "express";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import app from "../api/index";

// Local production-artifact smoke server, not a second deployment entry point.
// Import the actual function handler without starting development polling jobs.
const config = JSON.parse(readFileSync("vercel.json", "utf8"));
app.use((_req, res, next) => {
  for (const header of config.headers[0].headers)
    res.setHeader(header.key, header.value);
  next();
});
app.use(express.static(resolve("dist")));
app.get("/assets/{*path}", (_req, res) => res.sendStatus(404));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(Number(process.env.PORT) || 5194, "127.0.0.1");
process.on("SIGTERM", () => server.close());
