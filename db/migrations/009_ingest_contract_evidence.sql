ALTER TABLE raw_receipts ADD COLUMN contract_version text;
ALTER TABLE raw_receipts ADD COLUMN contract_ref text;
ALTER TABLE raw_receipts ADD COLUMN contract_sha256 char(64);
ALTER TABLE raw_receipts ADD COLUMN contract_snapshot jsonb;
ALTER TABLE raw_receipts ADD CONSTRAINT contract_evidence_complete CHECK (
  (contract_version IS NULL AND contract_ref IS NULL AND contract_sha256 IS NULL AND contract_snapshot IS NULL)
  OR (contract_version IS NOT NULL AND contract_ref IS NOT NULL AND contract_sha256 IS NOT NULL AND contract_snapshot IS NOT NULL)
);
