export type Role = 'super_admin' | 'team_admin' | 'operator';
export type PaymentMethod = 'cash' | 'online';
export type InvoiceStatus = 'unprocessed' | 'processed';
export type InvoiceType = 'catering' | 'fuel' | 'consumable' | 'printing' | 'other';
export type ExportImageMode = 'invoice_only' | 'proof_only' | 'both';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  teamId: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
  user: AuthUser;
}

export interface Team { id: string; name: string; status: 'active' | 'disabled'; createdAt: string; }

export interface UserRow {
  id: string;
  username: string;
  role: Role;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InvoiceImage { id: string; originalFilename: string; sizeBytes: number; uploadedAt: string; }

export interface InvoiceFull {
  id: string;
  teamId: string;
  operatorId: string;
  operatorUsername: string | null;
  amount: number | null;
  invoiceType: InvoiceType | null;
  paymentMethod: PaymentMethod;
  status: InvoiceStatus;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  processedBy: string | null;
  invoiceImages: InvoiceImage[];
  proofImages: InvoiceImage[];
  rowNumber?: number;
}

export interface InvoiceListResponse {
  items: InvoiceFull[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExportPart {
  kind: 'xlsx' | 'invoice-zip' | 'proof-zip';
  href: string;
  filename: string;
}

export interface ExportManifest {
  parts: ExportPart[];
  expiresInSec: number;
}
