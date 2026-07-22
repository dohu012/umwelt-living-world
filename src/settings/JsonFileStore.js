import fs from 'node:fs';
import path from 'node:path';

/** Generic read/write for a single JSON file, creating parent dirs on save. */
export class JsonFileStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load(defaultValue) {
    if (!fs.existsSync(this.filePath)) return structuredClone(defaultValue);
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  save(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(value, null, 2));
  }
}
