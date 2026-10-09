/* Adds the columns the admin usage summary needs. Run this once in the D1 console against the
   existing live database -- db/schema.sql already has these columns built in for a brand new
   database, so this file is only for a database created before this feature existed. */

ALTER TABLE projects ADD COLUMN ai_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN ai_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN ai_output_tokens INTEGER NOT NULL DEFAULT 0;
