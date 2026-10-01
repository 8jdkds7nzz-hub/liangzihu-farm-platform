CREATE TABLE knowledge_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL,version text NOT NULL,object_ids uuid[] NOT NULL CHECK(cardinality(object_ids)>0),
 source_ref text NOT NULL,source_url text,source_checksum char(64) NOT NULL,body text NOT NULL,format text NOT NULL CHECK(format IN ('markdown','text')),
 evidence_nature text NOT NULL,state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','withdrawn')),
 approved_by uuid REFERENCES users(id),approved_at timestamptz,withdrawn_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source_ref,version)
);
CREATE TABLE knowledge_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES knowledge_documents(id),position integer NOT NULL,heading text NOT NULL,
 text text NOT NULL,keywords text[] NOT NULL,embedding public.vector(512),embedding_model text,
 UNIQUE(document_id,position)
);
CREATE INDEX knowledge_terms ON knowledge_chunks USING gin(keywords);
CREATE TRIGGER immutable_knowledge_origin BEFORE UPDATE OF title,version,object_ids,source_ref,source_url,source_checksum,body,format,evidence_nature ON knowledge_documents FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_chunk_text BEFORE UPDATE OF document_id,position,heading,text,keywords ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
