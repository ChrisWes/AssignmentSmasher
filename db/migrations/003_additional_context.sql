/* Adds the column the project settings page's "Additional context" box needs. Run this once in
   the D1 console against the existing live database -- db/schema.sql already has this column
   built in for a brand new database, so this file is only for a database created before this
   feature existed. */

ALTER TABLE projects ADD COLUMN additional_context TEXT NOT NULL DEFAULT '';
