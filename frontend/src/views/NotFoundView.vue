<script setup lang="ts">
import { Empty, Button } from 'vant';
import { useRouter } from 'vue-router';
const router = useRouter();
</script>
<template>
  <Empty description="页面不存在">
    <Button type="primary" @click="router.push('/')">返回首页</Button>
  </Empty>
</template>
