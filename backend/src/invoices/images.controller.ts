import { Controller, Get, Param } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { InvoicesService } from './invoices.service';

@Controller('invoices/:invoiceId')
export class ImagesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('images/:imageId/url')
  invoiceImageUrl(
    @CurrentUser() me: JwtPayload,
    @Param('invoiceId') invoiceId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.invoices.signImageUrl(
      { role: me.role as Role, teamId: me.teamId ? BigInt(me.teamId) : null, userId: BigInt(me.sub) },
      'invoice',
      BigInt(invoiceId),
      BigInt(imageId),
    );
  }

  @Get('proofs/:imageId/url')
  proofImageUrl(
    @CurrentUser() me: JwtPayload,
    @Param('invoiceId') invoiceId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.invoices.signImageUrl(
      { role: me.role as Role, teamId: me.teamId ? BigInt(me.teamId) : null, userId: BigInt(me.sub) },
      'proof',
      BigInt(invoiceId),
      BigInt(imageId),
    );
  }
}
