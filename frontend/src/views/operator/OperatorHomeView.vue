<script setup lang="ts">
import { onActivated, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Empty, List, PullRefresh, showToast } from 'vant';
import InvoiceListItem from '@/components/InvoiceListItem.vue';
import { invoicesApi } from '@/api/invoices';
import type { InvoiceFull } from '@/types/api';

const router = useRouter();
const items = ref<InvoiceFull[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await invoicesApi.myList({ page: page.value, pageSize });
    if (page.value === 1) items.value = res.items;
    else items.value.push(...res.items);
    total.value = res.total;
    if (items.value.length >= total.value) finished.value = true;
    else page.value += 1;
  } catch {
    showToast({ type: 'fail', message: '加载失败' });
    finished.value = true;
  } finally {
    loading.value = false;
  }
}

async function onRefresh() {
  page.value = 1;
  finished.value = false;
  items.value = [];
  refreshing.value = true;
  await load();
  refreshing.value = false;
}

onActivated(() => { onRefresh(); });
load();

function open(id: string) { router.push({ name: 'op-detail', params: { id } }); }
</script>

<template>
  <PullRefresh v-model="refreshing" @refresh="onRefresh">
    <List v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="load">
      <InvoiceListItem
        v-for="inv in items"
        :key="inv.id"
        :invoice="inv"
        @click="open(inv.id)"
      />
      <Empty v-if="!loading && items.length === 0" description="还没有发票，去上传一张" />
    </List>
  </PullRefresh>
</template>
