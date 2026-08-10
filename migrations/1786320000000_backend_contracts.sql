-- Up Migration

ALTER TABLE credit_lines
  ADD CONSTRAINT credit_lines_maximum_amount CHECK (credit_limit <= 99999999);

ALTER TABLE purchases
  ADD CONSTRAINT purchases_maximum_amount CHECK (amount <= 99999999);

ALTER TABLE installments
  ADD CONSTRAINT installments_maximum_amount CHECK (amount <= 99999999);

ALTER TABLE idempotency_keys ADD COLUMN response_code TEXT;

UPDATE idempotency_keys
   SET response_code = CASE
     WHEN response_body ? 'code' THEN response_body ->> 'code'
     WHEN operation = 'purchase' AND response_status = 201 THEN 'PURCHASE_CREATED'
     WHEN operation = 'payment' AND response_status = 200 THEN 'PAYMENT_COMPLETED'
     ELSE 'INTERNAL_ERROR'
   END
 WHERE response_status IS NOT NULL;

UPDATE idempotency_keys
   SET response_body = CASE
     WHEN response_code IN ('PURCHASE_CREATED', 'PAYMENT_COMPLETED')
          AND (response_body ? 'data' OR response_body ? 'legacyBody')
       THEN response_body
     WHEN response_code IN ('PURCHASE_CREATED', 'PAYMENT_COMPLETED')
       THEN jsonb_build_object('legacyBody', response_body)
     ELSE jsonb_build_object('message', COALESCE(response_body ->> 'error', 'Operation failed'))
   END
 WHERE response_status IS NOT NULL;

ALTER TABLE idempotency_keys DROP CONSTRAINT idempotency_response_pair;
ALTER TABLE idempotency_keys DROP COLUMN response_status;
ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_response_pair CHECK (
    (response_code IS NULL AND response_body IS NULL) OR
    (response_code IS NOT NULL AND response_body IS NOT NULL)
  );

-- Down Migration

ALTER TABLE idempotency_keys ADD COLUMN response_status INTEGER;

UPDATE idempotency_keys
   SET response_status = CASE response_code
     WHEN 'PURCHASE_CREATED' THEN 201
     WHEN 'PAYMENT_COMPLETED' THEN 200
     WHEN 'NOT_FOUND' THEN 404
     WHEN 'INVALID_AMOUNT' THEN 400
     WHEN 'INVALID_INPUT' THEN 400
     WHEN 'IDEMPOTENCY_KEY_REQUIRED' THEN 400
     WHEN 'UNAUTHORIZED' THEN 401
     ELSE 409
   END
 WHERE response_code IS NOT NULL;

UPDATE idempotency_keys
   SET response_body = CASE
     WHEN response_code IN ('PURCHASE_CREATED', 'PAYMENT_COMPLETED')
          AND response_body ? 'legacyBody'
       THEN response_body -> 'legacyBody'
     WHEN response_code = 'PURCHASE_CREATED' AND response_body ? 'data'
       THEN (
         SELECT jsonb_build_object(
           'purchase', jsonb_build_object(
             'id', response_body #> '{data,purchase,id}',
             'amount', (response_body #>> '{data,purchase,amount}')::BIGINT,
             'installments', (response_body #>> '{data,purchase,installments}')::INTEGER,
             'status', CASE WHEN all_paid THEN 'paid' ELSE 'pending' END,
             'createdAt', response_body #> '{data,purchase,created_at}',
             'paymentMethod', jsonb_build_object(
               'brand', response_body #> '{data,purchase,brand}',
               'last4', response_body #> '{data,purchase,last4}'
             ),
             'installmentsPlan', plan,
             'plan', plan
           ),
           'available', (response_body #>> '{data,available}')::BIGINT
         )
         FROM (
           SELECT
             bool_and(item ->> 'status' = 'paid') AS all_paid,
             jsonb_agg(
               jsonb_build_object(
                 'id', item -> 'id',
                 'number', (item ->> 'number')::INTEGER,
                 'amount', (item ->> 'amount')::BIGINT,
                 'dueDate', left(item ->> 'due_date', 10),
                 'status', item -> 'status',
                 'paidAt', item -> 'paid_at'
               )
               ORDER BY (item ->> 'number')::INTEGER
             ) AS plan
           FROM jsonb_array_elements(response_body #> '{data,installments}') AS installment(item)
         ) AS legacy_purchase
       )
     WHEN response_code = 'PAYMENT_COMPLETED' AND response_body ? 'data'
       THEN jsonb_build_object(
         'installment', jsonb_build_object(
           'id', response_body #> '{data,installment,id}',
           'number', (response_body #>> '{data,installment,number}')::INTEGER,
           'amount', (response_body #>> '{data,installment,amount}')::BIGINT,
           'dueDate', left(response_body #>> '{data,installment,due_date}', 10),
           'status', response_body #> '{data,installment,status}',
           'paidAt', response_body #> '{data,installment,paid_at}'
         ),
         'available', (response_body #>> '{data,available}')::BIGINT
       )
     ELSE jsonb_build_object(
       'error', COALESCE(response_body ->> 'message', 'Operation failed'),
       'code', response_code
     )
   END
 WHERE response_code IS NOT NULL;

ALTER TABLE idempotency_keys DROP CONSTRAINT idempotency_response_pair;
ALTER TABLE idempotency_keys DROP COLUMN response_code;
ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_response_pair CHECK (
    (response_status IS NULL AND response_body IS NULL) OR
    (response_status IS NOT NULL AND response_body IS NOT NULL)
  );

ALTER TABLE installments DROP CONSTRAINT installments_maximum_amount;
ALTER TABLE purchases DROP CONSTRAINT purchases_maximum_amount;
ALTER TABLE credit_lines DROP CONSTRAINT credit_lines_maximum_amount;
