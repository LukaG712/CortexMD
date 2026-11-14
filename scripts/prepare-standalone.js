const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const standaloneDir = path.join(root, ".next", "standalone");

if (!fs.existsSync(standaloneDir)) {
  console.error("Error: .next/standalone not found. Run 'npm run build' first.");
  process.exit(1);
}

const copyTasks = [
  {
    src: path.join(root, "public"),
    dest: path.join(standaloneDir, "public"),
  },
  {
    src: path.join(root, ".next", "static"),
    dest: path.join(standaloneDir, ".next", "static"),
  },
];

for (const task of copyTasks) {
  if (fs.existsSync(task.src)) {
    fs.mkdirSync(path.dirname(task.dest), { recursive: true });
    fs.cpSync(task.src, task.dest, { recursive: true });
    console.log(`Copied ${task.src} -> ${task.dest}`);
  }
}

console.log("Standalone bundle preparation complete.");
