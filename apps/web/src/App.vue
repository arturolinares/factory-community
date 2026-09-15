<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import AppShell from './components/AppShell.vue'
import { useSettings } from './stores/settings.js'

/**
 * The stored interface size is applied here, once, before any page cares.
 *
 * There is a beat of unscaled board while the request lands, which is the cost
 * of keeping the setting in the installation rather than in this browser — and
 * the reason it is kept there is that the desktop app and a tab pointed at the
 * same daemon must not disagree about the same installation.
 */
const settings = useSettings()
onMounted(() => void settings.load())
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
</template>
