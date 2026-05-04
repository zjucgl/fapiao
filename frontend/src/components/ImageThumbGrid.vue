<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Image as VanImage, Icon, showImagePreview } from 'vant';
import type { InvoiceImage } from '@/types/api';

const props = defineProps<{
  invoiceId: string;
  images: InvoiceImage[];
  kind: 'invoice' | 'proof';
  signFn: (invoiceId: string, imageId: string) => Promise<{ url: string; expiresInSec: number }>;
}>();

const urls = ref<string[]>([]);

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
  props.images.map((img, idx) => ({ idx, isPdf: isPdf(img.originalFilename) }))
    .filter((x) => !x.isPdf)
    .map((x) => x.idx),
);

function onClick(idx: number) {
  if (!urls.value[idx]) return;
  const img = props.images[idx];
  if (isPdf(img.originalFilename)) {
    // PDF：新标签页打开，用浏览器自带 PDF 阅读器
    window.open(urls.value[idx], '_blank', 'noopener,noreferrer');
    return;
  }
  // 图片：用 Vant ImagePreview 全屏滑动
  const imageUrls = imageIndices.value.map((i) => urls.value[i]).filter(Boolean);
  const startPosition = imageIndices.value.indexOf(idx);
  if (imageUrls.length === 0 || startPosition < 0) return;
  showImagePreview({ images: imageUrls, startPosition });
}
</script>

<template>
  <div class="grid">
    <div v-for="(img, i) in images" :key="img.id" class="thumb" @click="onClick(i)">
      <!-- PDF：图标 -->
      <div v-if="isPdf(img.originalFilename)" class="pdf-tile">
        <Icon name="description" size="40" color="#ee0a24" />
        <div class="pdf-label">PDF</div>
      </div>
      <!-- 图片：缩略图 -->
      <VanImage v-else-if="urls[i]" :src="urls[i]" fit="cover" lazy-load />
      <div v-else class="placeholder">…</div>
      <div class="cap">{{ img.originalFilename }}</div>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px; }
.thumb { position: relative; aspect-ratio: 1; cursor: pointer; }
.thumb :deep(.van-image) { width: 100%; height: 100%; }
.placeholder { width: 100%; height: 100%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; }
.pdf-tile { width: 100%; height: 100%; background: #fff5f5; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 1px solid #ffd7d7; }
.pdf-label { font-size: 12px; color: #ee0a24; font-weight: 600; }
.cap { position: absolute; bottom: 0; left: 0; right: 0; font-size: 10px; color: white; background: rgba(0,0,0,0.6); padding: 2px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
