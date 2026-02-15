-- Sample e-commerce data for building internal tools against
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  stock_quantity INT DEFAULT 0,
  category VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  total DECIMAL(10,2) NOT NULL,
  shipping_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed sample data
INSERT INTO customers (name, email, phone, address) VALUES
  ('Alice Johnson', 'alice@example.com', '555-0101', '123 Main St, NYC'),
  ('Bob Smith', 'bob@example.com', '555-0102', '456 Oak Ave, LA'),
  ('Charlie Brown', 'charlie@example.com', '555-0103', '789 Pine Rd, Chicago'),
  ('Diana Prince', 'diana@example.com', '555-0104', '321 Elm St, Seattle'),
  ('Eve Davis', 'eve@example.com', '555-0105', '654 Maple Dr, Boston');

INSERT INTO products (name, description, price, stock_quantity, category) VALUES
  ('Wireless Mouse', 'Ergonomic wireless mouse with USB receiver', 29.99, 150, 'Electronics'),
  ('Mechanical Keyboard', 'RGB mechanical keyboard with Cherry MX switches', 89.99, 75, 'Electronics'),
  ('USB-C Hub', '7-in-1 USB-C hub with HDMI, USB 3.0, SD card', 49.99, 200, 'Electronics'),
  ('Laptop Stand', 'Adjustable aluminum laptop stand', 39.99, 100, 'Accessories'),
  ('Webcam HD', '1080p webcam with built-in microphone', 59.99, 80, 'Electronics'),
  ('Desk Lamp', 'LED desk lamp with adjustable brightness', 34.99, 120, 'Accessories'),
  ('Monitor Arm', 'Single monitor arm, supports up to 32"', 79.99, 60, 'Accessories'),
  ('Cable Organizer', 'Desktop cable management kit', 14.99, 300, 'Accessories');

INSERT INTO orders (customer_id, status, total, shipping_address) VALUES
  (1, 'delivered', 119.98, '123 Main St, NYC'),
  (2, 'shipped', 89.99, '456 Oak Ave, LA'),
  (3, 'processing', 64.98, '789 Pine Rd, Chicago'),
  (1, 'pending', 79.99, '123 Main St, NYC'),
  (4, 'delivered', 179.97, '321 Elm St, Seattle'),
  (5, 'cancelled', 29.99, '654 Maple Dr, Boston');

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
  (1, 1, 1, 29.99), (1, 4, 1, 39.99), (1, 6, 1, 34.99),
  (2, 2, 1, 89.99),
  (3, 8, 2, 14.99), (3, 6, 1, 34.99),
  (4, 7, 1, 79.99),
  (5, 3, 1, 49.99), (5, 5, 1, 59.99), (5, 1, 1, 29.99),
  (6, 1, 1, 29.99);
