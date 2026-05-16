import './server/_core/env.ts';
import { db } from './server/db.ts';
import { sql } from 'drizzle-orm';

const result = await db.execute(sql`DESCRIBE prop_predictions`);
const rows = result[0] as any[];
console.log('prop_predictions columns:');
rows.forEach((r: any) => console.log(' -', r.Field, r.Type));
