process.stderr.write(`${JSON.stringify({ type: "ready" })}\n`);

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffered += chunk;
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() !== "stdout") {
      continue;
    }
    process.stdout.write(`${JSON.stringify({ type: "released" })}\n`);
    process.exit(0);
  }
});
