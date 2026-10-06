-- AlterTable
-- HCA's nickname, the name the site shows. `name` keeps the full "first last"
-- string: the Airtable RSVP/YSWS rows and Ari split it into first/last.
ALTER TABLE "user" ADD COLUMN     "displayName" TEXT;
