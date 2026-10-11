-- A reel post the server refused. Every refusal is silent today: withRoute turns
-- an HttpError into a response without recording anything, so a maker stuck
-- behind an owed reel or an upload-ownership check leaves no trace at all.
ALTER TYPE "AuditAction" ADD VALUE 'USER_CREATE_POST_FAILED';