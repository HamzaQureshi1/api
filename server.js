require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const { z } = require('zod');
const { createClient } = require('redis');

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

const { performance } = require('perf_hooks');

app.use((req, res, next) => {
  const start = performance.now();
  
  res.on('finish', () => {
    const duration = performance.now() - start;
    console.log(`🕒 ${req.method} ${req.originalUrl} - ${duration.toFixed(2)}ms`);
  });

  next();
});

// Connect to MongoDB
const client = new MongoClient(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

let db;
client.connect()
  .then(async () => {
    db = client.db('dummyDB');
    console.log('✅ Connected to MongoDB');

    // Ensure index exists on the NINO field
    await db.collection('mappings').createIndex({ NINO: 1 }, { unique: true });
    console.log('✅ Index created on NINO field');

  })
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

const redisClient = createClient({
     url: 'redis://127.0.0.1:6379'
});

redisClient.connect()
  .then(() => console.log('✅ Connected to Redis'))
  .catch((err) => console.error('❌ Redis Connection Error:', err));

const mappingSchema = z.object({
  NINO: z.string().min(5).max(10),
  GUID: z.string().uuid()
});  

// Create Mapping (Store in MongoDB and Redis Cache)
app.post('/mappings', async (req, res) => {
  try {
    const mapping = mappingSchema.parse(req.body);
    const { GUID, NINO } = mapping;

    // Check if GUID already exists in Redis (idempotency check)
    const existingMapping = await redisClient.get(GUID);
    if (existingMapping) {
      console.log('⚠️ Duplicate request detected! Returning cached response.');
      return res.status(200).json(JSON.parse(existingMapping));
    }

    // Insert into MongoDB
    const result = await db.collection('mappings').insertOne(mapping);

    // Store mapping in Redis with expiry (for idempotency and fast retrieval)
    await redisClient.set(GUID, JSON.stringify(mapping), { EX: 60 }); // Cache for 60 sec
    await redisClient.set(NINO, JSON.stringify(mapping), { EX: 60 });

    console.log('✅ Mapping stored in Redis cache.');
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(400).json({ error: error.message });
  }
});

// Get Mapping (Fetch from Redis or MongoDB)
app.get('/mappings/:nino', async (req, res) => {
  try {
    const nino = req.params.nino;

    // Step 1: Check Redis cache first
    const cachedMapping = await redisClient.get(nino);
    if (cachedMapping) {
      console.log('✅ Cache hit! Returning data from Redis.');
      return res.json(JSON.parse(cachedMapping));
    }

    // Step 2: If not found in cache, fetch from MongoDB
    const mapping = await db.collection('mappings').findOne({ NINO: nino });
    if (!mapping) return res.status(404).json({ message: 'Mapping not found' });

    // Step 3: Store result in Redis for future requests (set expiry time)
    await redisClient.set(nino, JSON.stringify(mapping), { EX: 60 });
    console.log('✅ MongoDB hit! Storing data in Redis cache for future requests.');

    res.json(mapping);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});