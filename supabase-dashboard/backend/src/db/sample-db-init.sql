CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  stock INTEGER DEFAULT 0,
  category VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  status VARCHAR(20) DEFAULT 'pending',
  total_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL,
  price_cents INTEGER NOT NULL
);

-- Seed sample data
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Wireless Mouse', 'Ergonomic wireless mouse', 2999, 150, 'Electronics'),
  ('Mechanical Keyboard', 'RGB mechanical keyboard', 8999, 75, 'Electronics'),
  ('USB-C Hub', '7-in-1 USB-C dock', 4999, 200, 'Electronics'),
  ('Monitor Stand', 'Adjustable monitor arm', 3499, 100, 'Furniture'),
  ('Desk Lamp', 'LED desk lamp with dimmer', 2499, 120, 'Lighting');

INSERT INTO customers (name, email) VALUES
  ('Alice Johnson', 'alice@example.com'),
  ('Bob Smith', 'bob@example.com'),
  ('Carol Williams', 'carol@example.com');

INSERT INTO orders (customer_id, status, total_cents) VALUES
  (1, 'completed', 11998),
  (2, 'pending', 8999),
  (3, 'completed', 7498);

INSERT INTO order_items (order_id, product_id, quantity, price_cents) VALUES
  (1, 1, 2, 2999),
  (1, 3, 1, 4999),
  (2, 2, 1, 8999),
  (3, 4, 1, 3499),
  (3, 5, 1, 2499);
