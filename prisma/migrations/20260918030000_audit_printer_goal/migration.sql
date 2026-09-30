-- Choosing a printer is an economic act: it decides how many hours of every
-- approved design week mint into the printer fund. It belongs in the audit log
-- for the same reason a tier assignment does.
ALTER TYPE "AuditAction" ADD VALUE 'USER_SET_PRINTER_GOAL';
