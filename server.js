require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

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
  .then(() => {
    db = client.db('dummyDB');
    console.log('Connected to MongoDB');
  })
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Create User (No Validation, No Indexing, No Caching)
app.post('/mappings', async (req, res) => {
  try {
    const mapping = req.body;
    const result = await db.collection('mappings').insertOne(mapping);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get User (No Caching, No Indexing)
app.get('/mappings/:nino', async (req, res) => {
  try {
    const mapping = await db.collection('mappings').findOne({ NINO: req.params.nino });
    if (!mapping) return res.status(404).json({ message: 'Mapping not found' });
    res.json(mapping);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

