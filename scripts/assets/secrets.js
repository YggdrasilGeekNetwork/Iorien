(function () {
  var STORAGE_KEY = "wiki-secret-passphrases";
  var ROLE_SALT_NAMESPACE = "iorien-wiki-role:";

  // Caches derived AES-GCM keys by "passphrase::roleId" so PBKDF2 (expensive by
  // design) only runs once per passphrase-role pair per page load, not once per block.
  var keyCache = {};

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function getPassphrases() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function savePassphrase(passphrase) {
    var list = getPassphrases();
    if (list.indexOf(passphrase) === -1) {
      list.push(passphrase);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
  }

  function forgetPassphrases() {
    sessionStorage.removeItem(STORAGE_KEY);
    keyCache = {};
  }

  async function roleSalt(roleId) {
    var digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(ROLE_SALT_NAMESPACE + roleId)
    );
    return new Uint8Array(digest);
  }

  async function deriveRoleKey(passphrase, roleId) {
    var cacheKey = passphrase + "::" + roleId;
    if (keyCache[cacheKey]) return keyCache[cacheKey];
    var salt = await roleSalt(roleId);
    var baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    var key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: 400000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    keyCache[cacheKey] = key;
    return key;
  }

  // Tries every known passphrase against every role this block was wrapped for;
  // returns the decrypted HTML string on first match, or null if none work.
  async function tryUnlock(secret, passphrases) {
    for (var i = 0; i < passphrases.length; i++) {
      var passphrase = passphrases[i];
      for (var roleId in secret.wraps) {
        if (!Object.prototype.hasOwnProperty.call(secret.wraps, roleId)) continue;
        try {
          var wrap = secret.wraps[roleId];
          var wrapKey = await deriveRoleKey(passphrase, roleId);
          var rawContentKey = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToBytes(wrap.iv) },
            wrapKey,
            base64ToBytes(wrap.wrappedKey)
          );
          var contentKey = await crypto.subtle.importKey(
            "raw",
            rawContentKey,
            "AES-GCM",
            false,
            ["decrypt"]
          );
          var plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToBytes(secret.iv) },
            contentKey,
            base64ToBytes(secret.ciphertext)
          );
          return new TextDecoder().decode(plain);
        } catch (e) {
          // wrong passphrase for this role entry, keep trying the rest
        }
      }
    }
    return null;
  }

  async function revealBlock(block, passphrases) {
    var raw = block.getAttribute("data-secret");
    if (!raw) return false;
    var secret;
    try {
      secret = JSON.parse(atob(raw));
    } catch (e) {
      return false;
    }
    var html = await tryUnlock(secret, passphrases);
    if (html === null) return false;
    var contentEl = block.querySelector(".secret-content");
    var lockedEl = block.querySelector(".secret-locked");
    contentEl.innerHTML = html;
    contentEl.hidden = false;
    if (lockedEl) lockedEl.hidden = true;
    block.classList.add("secret-unlocked");
    return true;
  }

  async function unlockAll() {
    var passphrases = getPassphrases();
    if (passphrases.length === 0) return;
    var blocks = document.querySelectorAll(".secret-block:not(.secret-unlocked)");
    for (var i = 0; i < blocks.length; i++) {
      await revealBlock(blocks[i], passphrases);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    unlockAll();

    var form = document.getElementById("unlock-form");
    var input = document.getElementById("unlock-input");
    var status = document.getElementById("unlock-status");
    var forgetButton = document.getElementById("forget-button");

    if (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var passphrase = input.value;
        if (!passphrase) return;
        savePassphrase(passphrase);
        input.value = "";
        var blocks = document.querySelectorAll(".secret-block:not(.secret-unlocked)");
        var unlockedAny = false;
        for (var i = 0; i < blocks.length; i++) {
          var ok = await revealBlock(blocks[i], [passphrase]);
          if (ok) unlockedAny = true;
        }
        if (status) {
          status.textContent = unlockedAny
            ? "Senha aceita."
            : "Senha não corresponde a nenhum conteúdo restrito nesta página.";
        }
      });
    }

    if (forgetButton) {
      forgetButton.addEventListener("click", function () {
        forgetPassphrases();
        document.querySelectorAll(".secret-block.secret-unlocked").forEach(function (block) {
          var contentEl = block.querySelector(".secret-content");
          var lockedEl = block.querySelector(".secret-locked");
          if (contentEl) {
            contentEl.hidden = true;
            contentEl.innerHTML = "";
          }
          if (lockedEl) lockedEl.hidden = false;
          block.classList.remove("secret-unlocked");
        });
        if (status) status.textContent = "Senhas esquecidas.";
      });
    }
  });
})();
