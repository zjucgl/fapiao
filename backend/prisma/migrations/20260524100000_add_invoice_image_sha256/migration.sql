-- AddColumn
ALTER TABLE `invoice_images` ADD COLUMN `content_sha256` CHAR(64) NULL;

-- CreateIndex
CREATE INDEX `invoice_images_content_sha256_idx` ON `invoice_images`(`content_sha256`);
