<template>
<div
  class="studio-editor-display"
  ref="display"
  @mousedown="handleMouseDown"
  @mouseup="handleMouseUp"
  @mousemove="handleMouseMove"
  @mouseenter="handleMouseEnter"/>
</template>

<script lang="ts" src="./StudioEditor.vue.ts"></script>

<style lang="less" scoped>
@import "../styles/index";

.studio-editor-display {
  position: relative;
  flex-grow: 1;
  background-color: @navy-secondary;
}
</style>
