import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InvoicesService } from './invoices.service';
import { ExportService } from './export/export.service';
import { OperatorInvoicesController } from './operator-invoices.controller';
import { ImagesController } from './images.controller';
import { AdminInvoicesController } from './admin-invoices.controller';

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 25 },
    }),
  ],
  controllers: [OperatorInvoicesController, ImagesController, AdminInvoicesController],
  providers: [InvoicesService, ExportService],
  exports: [InvoicesService, ExportService],
})
export class InvoicesModule {}
