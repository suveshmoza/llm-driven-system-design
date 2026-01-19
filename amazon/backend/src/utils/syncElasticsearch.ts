import 'dotenv/config';
import { initializeDb, query } from '../services/database.js';
import { initializeElasticsearch, bulkIndexProducts, Product } from '../services/elasticsearch.js';

interface ProductRow {
  id: number;
  title: string;
  slug: string;
  description?: string;
  price: string;
  compare_at_price?: string;
  images?: string[];
  rating?: string;
  review_count?: number;
  attributes?: Record<string, unknown>;
  category_id?: number;
  category_name?: string;
  category_slug?: string;
  seller_id?: number;
  seller_name?: string;
  stock_quantity?: string;
  created_at?: Date;
}

async function syncElasticsearch(): Promise<void> {
  try {
    console.log('Connecting to database...');
    await initializeDb();

    console.log('Connecting to Elasticsearch...');
    await initializeElasticsearch();

    console.log('Fetching products...');
    const result = await query<ProductRow>(
      `SELECT p.*, c.name as category_name, c.slug as category_slug,
              s.business_name as seller_name,
              COALESCE(SUM(i.quantity - i.reserved), 0) as stock_quantity
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN sellers s ON p.seller_id = s.id
       LEFT JOIN inventory i ON p.id = i.product_id
       WHERE p.is_active = true
       GROUP BY p.id, c.name, c.slug, s.business_name`
    );

    console.log(`Found ${result.rows.length} products to index`);

    if (result.rows.length > 0) {
      const products: Product[] = result.rows.map(row => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        description: row.description,
        category_id: row.category_id,
        category_name: row.category_name,
        category_slug: row.category_slug,
        seller_id: row.seller_id,
        seller_name: row.seller_name,
        price: row.price,
        compare_at_price: row.compare_at_price,
        rating: row.rating,
        review_count: row.review_count,
        stock_quantity: parseInt(row.stock_quantity || '0'),
        attributes: row.attributes,
        images: row.images,
        created_at: row.created_at
      }));

      await bulkIndexProducts(products);
      console.log('Products indexed successfully!');
    }

    process.exit(0);
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

syncElasticsearch();
