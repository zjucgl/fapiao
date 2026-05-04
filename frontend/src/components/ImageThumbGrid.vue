<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { Image as VanImage, Icon, showImagePreview } from 'vant';
import type { InvoiceImage } from '@/types/api';

// 异步加载 PDF.js（约 800KB gzip），只在网格里出现 PDF 时才进
const VuePdfEmbed = defineAsyncComponent(() => import('vue-pdf-embed'));
const PdfPreviewPopup = defineAsyncComponent(() => import('./PdfPreviewPopup.vue'));

const props = defineProps<{
  invoiceId: string;
  images: InvoiceImage[];
  kind: 'invoice' | 'proof';
  signFn: (invoiceId: string, imageId: string) => Promise<{ url: string; expiresInSec: number }>;
}>();

const urls = ref<string[]>([]);
const pdfShow = ref(false);
const pdfUrl = ref('');
const pdfFilename = ref('');

onMounted(async () => {
  urls.value = await Promise.all(
    props.images.map(async (img) => {
      try { return (await props.signFn(props.invoiceId, img.id)).url; }
      catch { return ''; }
    }),
  );
});

function isPdf(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

const imageIndices = computed(() =>
  props.images
    .map((img, idx) => ({ idx, isPdf: isPdf(img.originalFilename) }))
    .filter((x) => !x.isPdf)
    .map((x) => x.idx),
);

function onClick(idx: number) {
  if (!urls.value[idx]) return;
  const img = props.images[idx];
  if (isPdf(img.originalFilename)) {
    pdfUrl.value = urls.value[idx];
    pdfFilename.value = img.originalFilename;
    pdfShow.value = true;
    return;
  }
  const imageUrls = imageIndices.value.map((i) => urls.value[i]).filter(Boolean);
  const startPosition = imageIndices.value.indexOf(idx);
  if (imageUrls.length === 0 || startPosition < 0) return;
  showImagePreview({ images: imageUrls, startPosition });
}
</script>

<template>
  <div class="grid">
    <div v-for="(img, i) in images" :key="img.id" class="thumb" @click="onClick(i)">
      <!-- PDF：第一页当缩略图 -->
      <template v-if="isPdf(img.originalFilename)">
        <div v-if="urls[i]" class="pdf-thumb">
          <VuePdfEmbed :source="urls[i]" :page="1" />
          <div class="pdf-badge">PDF</div>
        </div>
        <div v-else class="pdf-fallback">
          <Icon name="description" size="40" color="#ee0a24" />
          <div class="pdf-label">PDF 加载中…</div>
        </div>
      </template>

      <!-- 图片缩略图 -->
      <VanImage v-else-if="urls[i]" :src="urls[i]" fit="cover" lazy-load />
      <div v-else class="placeholder">…</div>

      <div class="cap">{{ img.originalFilename }}</div>
    </div>
  </div>

  <PdfPreviewPopup v-model:show="pdfShow" :url="pdfUrl" :filename="pdfFilename" />
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px; }
.thumb { position: relative; aspect-ratio: 1; cursor: pointer; overflow: hidden; background: #fafafa; border: 1px solid #eee; }
.thumb :deep(.van-image) { width: 100%; height: 100%; }
.placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.pdf-thumb { width: 100%; height: 100%; overflow: hidden; position: relative; background: white; }
.pdf-thumb :deep(canvas) { width: 100% !important; height: auto !important; }
.pdf-thumb :deep(.vue-pdf-embed__page) { margin: 0; }
.pdf-fallback { width: 100%; height: 100%; background: #fff5f5; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
.pdf-label { font-size: 10px; color: #ee0a24; }
.pdf-badge { position: absolute; top: 4px; right: 4px; background: #ee0a24; color: white; font-size: 10px; padding: 1px 4px; border-radius: 2px; font-weight: 600; }
.cap { position: absolute; bottom: 0; left: 0; right: 0; font-size: 10px; color: white; background: rgba(0,0,0,0.6); padding: 2px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; z-index: 1; }
</style>
