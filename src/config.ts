import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3000),
});

export const config = configSchema.parse(process.env);