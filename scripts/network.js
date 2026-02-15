export function createNetworkController({
  moduleId,
  socket,
  resolveTemplateId,
  resolveTileId,
  resolveRegionId,
  shaderOn,
  shaderOff,
  shaderToggle,
  shaderOnTemplate,
  shaderOffTemplate,
  shaderToggleTemplate,
  shaderOnTile,
  shaderOffTile,
  shaderToggleTile,
  shaderOnRegion,
  shaderOffRegion,
  shaderToggleRegion,
  shaderOffRegionBehavior,
  deleteAllTokenFX,
  deleteAllTemplateFX,
  deleteAllTileFX
}) {
  function isGmAllowedToBroadcast() {
    const gmOnly = game.settings.get(moduleId, "gmOnlyBroadcast");
    if (!gmOnly) return true;
    return game.user.isGM;
  }

  function isMsgFromGM(msg) {
    const u = game.users?.get(msg?.userId);
    return !!u?.isGM;
  }

  function normalizeTokenBroadcastPayload(payloadOrTokenId, maybeOpts) {
    if (payloadOrTokenId && typeof payloadOrTokenId === "object" && !Array.isArray(payloadOrTokenId)) {
      return payloadOrTokenId;
    }
    return { tokenId: payloadOrTokenId, opts: maybeOpts };
  }

  function normalizeTemplateBroadcastPayload(payloadOrTemplateId, maybeOpts) {
    if (payloadOrTemplateId && typeof payloadOrTemplateId === "object" && !Array.isArray(payloadOrTemplateId)) {
      return payloadOrTemplateId;
    }
    return { templateId: payloadOrTemplateId, opts: maybeOpts };
  }

  function normalizeTileBroadcastPayload(payloadOrTileId, maybeOpts) {
    if (payloadOrTileId && typeof payloadOrTileId === "object" && !Array.isArray(payloadOrTileId)) {
      return payloadOrTileId;
    }
    return { tileId: payloadOrTileId, opts: maybeOpts };
  }

  function normalizeRegionBroadcastPayload(payloadOrRegionId, maybeOpts) {
    if (payloadOrRegionId && typeof payloadOrRegionId === "object" && !Array.isArray(payloadOrRegionId)) {
      return payloadOrRegionId;
    }
    return { regionId: payloadOrRegionId, opts: maybeOpts };
  }

  function normalizeRegionBehaviorBroadcastPayload(payloadOrRegionId, maybeBehaviorId) {
    if (payloadOrRegionId && typeof payloadOrRegionId === "object" && !Array.isArray(payloadOrRegionId)) {
      return payloadOrRegionId;
    }
    return { regionId: payloadOrRegionId, behaviorId: maybeBehaviorId };
  }

  function broadcastShaderOn(payload) {
    const { tokenId, opts } = payload ?? {};
    if (!tokenId) return;
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_ON",
      tokenId,
      opts,
      userId: game.user.id
    });

    shaderOn(tokenId, opts);
  }

  function broadcastShaderOff(payload) {
    const { tokenId } = payload ?? {};
    if (!tokenId) return;
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_OFF",
      tokenId,
      userId: game.user.id
    });

    shaderOff(tokenId);
  }

  function broadcastShaderToggle(payload) {
    const { tokenId, opts } = payload ?? {};
    if (!tokenId) return;
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TOGGLE",
      tokenId,
      opts,
      userId: game.user.id
    });

    shaderToggle(tokenId, opts);
  }

  function broadcastShaderOnTemplate(payload) {
    const { templateId, opts } = payload ?? {};
    const resolvedTemplateId = resolveTemplateId(templateId);
    if (!resolvedTemplateId) {
      return ui.notifications.warn("No measured template found. Create one first or pass templateId.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TEMPLATE_ON",
      templateId: resolvedTemplateId,
      opts,
      userId: game.user.id
    });

    shaderOnTemplate(resolvedTemplateId, opts);
  }

  function broadcastShaderOffTemplate(payload) {
    const { templateId } = payload ?? {};
    const resolvedTemplateId = resolveTemplateId(templateId);
    if (!resolvedTemplateId) {
      return ui.notifications.warn("No measured template found. Create one first or pass templateId.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TEMPLATE_OFF",
      templateId: resolvedTemplateId,
      userId: game.user.id
    });

    shaderOffTemplate(resolvedTemplateId);
  }

  function broadcastShaderToggleTemplate(payload) {
    const { templateId, opts } = payload ?? {};
    const resolvedTemplateId = resolveTemplateId(templateId);
    if (!resolvedTemplateId) {
      return ui.notifications.warn("No measured template found. Create one first or pass templateId.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TEMPLATE_TOGGLE",
      templateId: resolvedTemplateId,
      opts,
      userId: game.user.id
    });

    shaderToggleTemplate(resolvedTemplateId, opts);
  }

  function broadcastShaderOnTile(payload) {
    const { tileId, opts } = payload ?? {};
    const resolvedTileId = resolveTileId(tileId);
    if (!resolvedTileId) {
      return ui.notifications.warn("No tile found. Create one first or pass tileId.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TILE_ON",
      tileId: resolvedTileId,
      opts,
      userId: game.user.id
    });

    shaderOnTile(resolvedTileId, opts);
  }

  function broadcastShaderOffTile(payload) {
    const { tileId } = payload ?? {};
    const resolvedTileId = resolveTileId(tileId);
    if (!resolvedTileId) {
      return ui.notifications.warn("No tile found. Create one first or pass tileId.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TILE_OFF",
      tileId: resolvedTileId,
      userId: game.user.id
    });

    shaderOffTile(resolvedTileId);
  }

  function broadcastShaderToggleTile(payload) {
    const { tileId, opts } = payload ?? {};
    const resolvedTileId = resolveTileId(tileId);
    if (!resolvedTileId) {
      return ui.notifications.warn("No tile found. Create one first or pass tileId.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TILE_TOGGLE",
      tileId: resolvedTileId,
      opts,
      userId: game.user.id
    });

    shaderToggleTile(resolvedTileId, opts);
  }

  function broadcastShaderOnRegion(payload) {
    const { regionId, opts } = payload ?? {};
    const resolvedRegionId = resolveRegionId(regionId);
    if (!resolvedRegionId) {
      return ui.notifications.warn("No region found. Create one first or pass regionId.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_REGION_ON",
      regionId: resolvedRegionId,
      opts,
      userId: game.user.id
    });

    shaderOnRegion(resolvedRegionId, opts);
  }

  function broadcastShaderOffRegion(payload) {
    const { regionId } = payload ?? {};
    const resolvedRegionId = resolveRegionId(regionId);
    if (!resolvedRegionId) {
      return ui.notifications.warn("No region found. Create one first or pass regionId.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_REGION_OFF",
      regionId: resolvedRegionId,
      userId: game.user.id
    });

    shaderOffRegion(resolvedRegionId);
  }

  function broadcastShaderOffRegionBehavior(payload) {
    const { regionId, behaviorId } = payload ?? {};
    const resolvedRegionId = resolveRegionId(regionId);
    if (!resolvedRegionId) {
      return ui.notifications.warn("No region found. Create one first or pass regionId.");
    }
    const targetBehaviorId = String(behaviorId ?? "");
    if (!targetBehaviorId) {
      return ui.notifications.warn("Missing behaviorId for region effect removal.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_REGION_BEHAVIOR_OFF",
      regionId: resolvedRegionId,
      behaviorId: targetBehaviorId,
      userId: game.user.id
    });

    shaderOffRegionBehavior(resolvedRegionId, targetBehaviorId);
  }

  function broadcastShaderToggleRegion(payload) {
    const { regionId, opts } = payload ?? {};
    const resolvedRegionId = resolveRegionId(regionId);
    if (!resolvedRegionId) {
      return ui.notifications.warn("No region found. Create one first or pass regionId.");
    }
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_REGION_TOGGLE",
      regionId: resolvedRegionId,
      opts,
      userId: game.user.id
    });

    shaderToggleRegion(resolvedRegionId, opts);
  }

  function broadcastDeleteAllTokenFX() {
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TOKEN_DELETE_ALL",
      userId: game.user.id
    });

    return deleteAllTokenFX();
  }

  function broadcastDeleteAllTemplateFX() {
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TEMPLATE_DELETE_ALL",
      userId: game.user.id
    });

    return deleteAllTemplateFX();
  }

  function broadcastDeleteAllTileFX() {
    if (!isGmAllowedToBroadcast()) {
      return ui.notifications.warn("Only the GM can broadcast this FX.");
    }

    game.socket.emit(socket, {
      senderSocketId: game.socket?.id,
      type: "SHADER_TILE_DELETE_ALL",
      userId: game.user.id
    });

    return deleteAllTileFX();
  }

  async function handleSocketMessage(msg) {
    const senderSocketId = String(msg?.senderSocketId ?? "");
    if (senderSocketId && senderSocketId === String(game.socket?.id ?? "")) return;
    const type = msg?.type;
    if (!type) return;

    if (type === "PING") {
      ui.notifications.info(`PING on ${game.user.name}`);
      return;
    }

    const gmRestrictedTypes = [
      "SHADER_ON",
      "SHADER_OFF",
      "SHADER_TOGGLE",
      "SHADER_TEMPLATE_ON",
      "SHADER_TEMPLATE_OFF",
      "SHADER_TEMPLATE_TOGGLE",
      "SHADER_TILE_ON",
      "SHADER_TILE_OFF",
      "SHADER_TILE_TOGGLE",
      "SHADER_REGION_ON",
      "SHADER_REGION_OFF",
      "SHADER_REGION_BEHAVIOR_OFF",
      "SHADER_REGION_TOGGLE",
      "SHADER_TOKEN_DELETE_ALL",
      "SHADER_TEMPLATE_DELETE_ALL",
      "SHADER_TILE_DELETE_ALL"
    ];
    if (!gmRestrictedTypes.includes(type)) return;

    if (game.settings.get(moduleId, "gmOnlyBroadcast") && !isMsgFromGM(msg)) return;

    try {
      switch (type) {
        case "SHADER_ON":
          shaderOn(msg.tokenId, msg.opts ?? {});
          return;
        case "SHADER_OFF":
          shaderOff(msg.tokenId);
          return;
        case "SHADER_TOGGLE":
          shaderToggle(msg.tokenId, msg.opts ?? {});
          return;
        case "SHADER_TEMPLATE_ON":
          shaderOnTemplate(msg.templateId, msg.opts ?? {});
          return;
        case "SHADER_TEMPLATE_OFF":
          shaderOffTemplate(msg.templateId);
          return;
        case "SHADER_TEMPLATE_TOGGLE":
          shaderToggleTemplate(msg.templateId, msg.opts ?? {});
          return;
        case "SHADER_TILE_ON":
          shaderOnTile(msg.tileId, msg.opts ?? {});
          return;
        case "SHADER_TILE_OFF":
          shaderOffTile(msg.tileId);
          return;
        case "SHADER_TILE_TOGGLE":
          shaderToggleTile(msg.tileId, msg.opts ?? {});
          return;
        case "SHADER_REGION_ON":
          shaderOnRegion(msg.regionId, msg.opts ?? {});
          return;
        case "SHADER_REGION_OFF":
          shaderOffRegion(msg.regionId);
          return;
        case "SHADER_REGION_BEHAVIOR_OFF":
          shaderOffRegionBehavior(msg.regionId, msg.behaviorId, { skipPersist: true });
          return;
        case "SHADER_REGION_TOGGLE":
          shaderToggleRegion(msg.regionId, msg.opts ?? {});
          return;
        case "SHADER_TOKEN_DELETE_ALL":
          await deleteAllTokenFX();
          return;
        case "SHADER_TEMPLATE_DELETE_ALL":
          await deleteAllTemplateFX();
          return;
        case "SHADER_TILE_DELETE_ALL":
          await deleteAllTileFX();
          return;
        default:
          return;
      }
    } catch (err) {
      switch (type) {
        case "SHADER_ON":
        case "SHADER_OFF":
        case "SHADER_TOGGLE":
        case "SHADER_TOKEN_DELETE_ALL":
          console.error(`${moduleId} shader broadcast failed:`, err);
          return;
        case "SHADER_TEMPLATE_ON":
        case "SHADER_TEMPLATE_OFF":
        case "SHADER_TEMPLATE_TOGGLE":
        case "SHADER_TEMPLATE_DELETE_ALL":
          console.error(`${moduleId} template shader broadcast failed:`, err);
          return;
        case "SHADER_TILE_ON":
        case "SHADER_TILE_OFF":
        case "SHADER_TILE_TOGGLE":
        case "SHADER_TILE_DELETE_ALL":
          console.error(`${moduleId} tile shader broadcast failed:`, err);
          return;
        case "SHADER_REGION_ON":
        case "SHADER_REGION_OFF":
        case "SHADER_REGION_BEHAVIOR_OFF":
        case "SHADER_REGION_TOGGLE":
          console.error(`${moduleId} region shader broadcast failed:`, err);
          return;
        default:
          console.error(`${moduleId} failed:`, err);
      }
    }
  }

  function registerSocketReceiver() {
    game.socket.on(socket, async (msg) => {
      await handleSocketMessage(msg);
    });
  }

  return {
    normalizeTokenBroadcastPayload,
    normalizeTemplateBroadcastPayload,
    normalizeTileBroadcastPayload,
    normalizeRegionBroadcastPayload,
    normalizeRegionBehaviorBroadcastPayload,
    broadcastShaderOn,
    broadcastShaderOff,
    broadcastShaderToggle,
    broadcastShaderOnTemplate,
    broadcastShaderOffTemplate,
    broadcastShaderToggleTemplate,
    broadcastShaderOnTile,
    broadcastShaderOffTile,
    broadcastShaderToggleTile,
    broadcastShaderOnRegion,
    broadcastShaderOffRegion,
    broadcastShaderOffRegionBehavior,
    broadcastShaderToggleRegion,
    broadcastDeleteAllTokenFX,
    broadcastDeleteAllTemplateFX,
    broadcastDeleteAllTileFX,
    registerSocketReceiver
  };
}
