-- Up Migration

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  document_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (length(btrim(email)) > 0),
  CONSTRAINT users_password_hash_not_blank CHECK (length(btrim(password_hash)) > 0),
  CONSTRAINT users_full_name_not_blank CHECK (length(btrim(full_name)) > 0),
  CONSTRAINT users_document_id_not_blank CHECK (length(btrim(document_id)) > 0)
);

CREATE TABLE credit_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  credit_limit BIGINT NOT NULL CHECK (credit_limit > 0),
  available BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'VES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_lines_available_bounds CHECK (available >= 0 AND available <= credit_limit)
);

CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  last4 CHAR(4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_methods_id_user_id_unique UNIQUE (id, user_id),
  CONSTRAINT payment_methods_brand_not_blank CHECK (length(btrim(brand)) > 0),
  CONSTRAINT payment_methods_last4_digits CHECK (last4 ~ '^[0-9]{4}$')
);

CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL CHECK (amount > 0),
  installments SMALLINT NOT NULL CHECK (installments IN (3, 6, 12)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchases_amount_covers_installments CHECK (amount >= installments),
  CONSTRAINT purchases_payment_method_owner
    FOREIGN KEY (payment_method_id, user_id)
    REFERENCES payment_methods(id, user_id)
);

CREATE TABLE installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  number SMALLINT NOT NULL CHECK (number >= 1),
  amount BIGINT NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT installments_unique_number UNIQUE (purchase_id, number),
  CONSTRAINT installments_paid_timestamp CHECK (
    (status = 'paid' AND paid_at IS NOT NULL) OR
    (status = 'pending' AND paid_at IS NULL)
  )
);

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('purchase', 'payment')),
  key TEXT NOT NULL CHECK (length(btrim(key)) BETWEEN 1 AND 255),
  request_hash TEXT,
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_unique_request UNIQUE (user_id, operation, key),
  CONSTRAINT idempotency_response_pair CHECK (
    (response_status IS NULL AND response_body IS NULL) OR
    (response_status IS NOT NULL AND response_body IS NOT NULL)
  )
);

CREATE INDEX purchases_user_id_created_at_idx ON purchases (user_id, created_at DESC);
CREATE INDEX installments_purchase_id_status_idx ON installments (purchase_id, status);
CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);

-- Down Migration

DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS installments;
DROP TABLE IF EXISTS purchases;
DROP TABLE IF EXISTS payment_methods;
DROP TABLE IF EXISTS credit_lines;
DROP TABLE IF EXISTS users;
