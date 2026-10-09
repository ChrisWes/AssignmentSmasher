/* Adds the columns the "check your draft" feature needs. Run this once in the D1 console against
   the existing live database — db/schema.sql already has these columns built in for a brand new
   database, so this file is only for a database created before this feature existed. */

ALTER TABLE projects ADD COLUMN feedback_status TEXT;
ALTER TABLE projects ADD COLUMN feedback_json TEXT;
ALTER TABLE projects ADD COLUMN feedback_error TEXT;
