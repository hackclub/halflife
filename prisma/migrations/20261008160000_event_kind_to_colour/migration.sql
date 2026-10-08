-- CreateEnum
CREATE TYPE "EventColour" AS ENUM ('CORAL', 'SKY', 'VIOLET', 'GOLD', 'TEAL', 'SLATE');

-- AlterTable
ALTER TABLE "program_event" DROP COLUMN "kind",
DROP COLUMN "link",
DROP COLUMN "location",
ADD COLUMN     "colour" "EventColour" NOT NULL DEFAULT 'SLATE';

-- DropEnum
DROP TYPE "EventKind";