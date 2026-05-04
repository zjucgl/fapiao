import { api } from './client';
import type {
  ExportImageMode, ExportManifest, InvoiceFull, InvoiceListResponse, InvoiceType, PaymentMethod,
} from '@/types/api';

export interface ListQuery {
  status?: string; invoiceType?: string; paymentMethod?: string;
  operatorId?: string; fromDate?: string; toDate?: string;
  amountRegistered?: 'true' | 'false';
  page?: number; pageSize?: number;
}

export const invoicesApi = {
  myList: (q: ListQuery = {}) => api.get<InvoiceListResponse>('/api/op/invoices', { params: q }).then((r) => r.data),
  myDetail: (id: string) => api.get<InvoiceFull>(`/api/op/invoices/${id}`).then((r) => r.data),
  myCreate: (form: FormData) => api.post<InvoiceFull>('/api/op/invoices', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  myUpdate: (id: string, dto: { paymentMethod?: PaymentMethod; remark?: string | null }) =>
    api.patch<InvoiceFull>(`/api/op/invoices/${id}`, dto).then((r) => r.data),
  myDelete: (id: string) => api.delete(`/api/op/invoices/${id}`).then((r) => r.data),

  adminList: (q: ListQuery = {}) => api.get<InvoiceListResponse>('/api/admin/invoices', { params: q }).then((r) => r.data),
  adminDetail: (id: string) => api.get<InvoiceFull>(`/api/admin/invoices/${id}`).then((r) => r.data),
  adminRegister: (id: string, dto: { amount?: number; invoiceType?: InvoiceType }) =>
    api.patch<InvoiceFull>(`/api/admin/invoices/${id}`, dto).then((r) => r.data),
  adminBatchProcess: (ids: string[]) => api.post<{ count: number }>('/api/admin/invoices/batch-process', { ids }).then((r) => r.data),
  adminExport: (ids: string[], mode: ExportImageMode, alsoMarkProcessed = false) =>
    api.post<ExportManifest>('/api/admin/invoices/export', { ids, mode, alsoMarkProcessed }).then((r) => r.data),

  signInvoiceImage: (invoiceId: string, imageId: string) =>
    api.get<{ url: string; expiresInSec: number }>(`/api/invoices/${invoiceId}/images/${imageId}/url`).then((r) => r.data),
  signProofImage: (invoiceId: string, imageId: string) =>
    api.get<{ url: string; expiresInSec: number }>(`/api/invoices/${invoiceId}/proofs/${imageId}/url`).then((r) => r.data),
};
