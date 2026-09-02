#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query, closePool } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '../../db/schema.sql');

const sql = await readFile(schemaPath, 'utf8');
await query(sql);
console.log('[db] Schema applique.');
await closePool();
