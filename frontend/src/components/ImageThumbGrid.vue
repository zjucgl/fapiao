<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Image as VanImage, showImagePreview } from 'vant';
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

function preview(idx: number) {
  const valid = urls.value.filter(Boolean);
  if (valid.length === 0) return;
  showImagePreview({ images: valid, startPosition: idx });
}
</script>

<template>
  <div class="grid">
    <div v-for="(img, i) in images" :key="img.id" class="thumb" @click="preview(i)">
      <VanImage v-if="urls[i]" :src="urls[i]" fit="cover" lazy-load />
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
.cap { position: absolute; bottom: 0; left: 0; right: 0; font-size: 10px; color: white; background: rgba(0,0,0,0.6); padding: 2px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
