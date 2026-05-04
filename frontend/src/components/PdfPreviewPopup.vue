<script setup lang="ts">
import { ref, watch } from 'vue';
import { Popup, Icon, Loading } from 'vant';
import VuePdfEmbed from 'vue-pdf-embed';

const props = defineProps<{
  show: boolean;
  url: string;
  filename?: string;
}>();
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>();

const loading = ref(true);
const pageCount = ref(0);

watch(() => props.show, (v) => { if (v) { loading.value = true; pageCount.value = 0; } });

function onLoaded(pdf: { numPages: number }) {
  pageCount.value = pdf.numPages;
  loading.value = false;
}

function onClose() { emit('update:show', false); }

async function onDownload() {
  if (!props.url) return;
  const a = document.createElement('a');
  a.href = props.url;
  a.download = props.filename || 'document.pdf';
  a.target = '_blank';
  document.body.appendChild(a); a.click(); a.remove();
}
</script>

<template>
  <Popup
    :show="show"
    @update:show="emit('update:show', $event)"
    position="bottom"
    :style="{ height: '100%', background: '#1a1a1a' }"
    :close-on-click-overlay="false"
    teleport="body"
  >
    <div class="pdf-wrap">
      <header class="pdf-header">
        <div class="title" :title="filename">{{ filename || 'PDF' }}</div>
        <div class="actions">
          <Icon name="down" size="22" color="white" @click="onDownload" title="下载" />
          <Icon name="cross" size="22" color="white" @click="onClose" title="关闭" />
        </div>
      </header>

      <div class="pdf-body">
        <div v-if="loading" class="loading">
          <Loading color="white" size="32" />
          <div style="margin-top: 12px;">加载 PDF…</div>
        </div>
        <VuePdfEmbed
          v-if="show"
          :source="url"
          @loaded="onLoaded"
          class="pdf-doc"
        />
      </div>

      <footer class="pdf-footer" v-if="!loading">
        共 {{ pageCount }} 页
      </footer>
    </div>
  </Popup>
</template>

<style scoped>
.pdf-wrap { display: flex; flex-direction: column; height: 100%; color: white; }
.pdf-header { display: flex; align-items: center; padding: 12px 16px; background: #000; flex-shrink: 0; gap: 12px; }
.pdf-header .title { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pdf-header .actions { display: flex; gap: 16px; }
.pdf-header .actions :deep(.van-icon) { cursor: pointer; }
.pdf-body { flex: 1; overflow-y: auto; padding: 16px 8px; background: #2a2a2a; }
.loading { text-align: center; padding: 64px 0; color: #ccc; font-size: 14px; }
.pdf-doc { background: white; }
.pdf-doc :deep(.vue-pdf-embed__page) { margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
.pdf-footer { padding: 8px 16px; background: #000; text-align: center; font-size: 12px; color: #aaa; flex-shrink: 0; }
</style>
