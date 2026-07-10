#include <node_api.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

// Hex helper functions
void bytes_to_hex(const unsigned char* bytes, int len, char* hex) {
    for (int i = 0; i < len; i++) {
        sprintf(hex + (i * 2), "%02x", bytes[i]);
    }
    hex[len * 2] = '\0';
}

void hex_to_bytes(const char* hex, unsigned char* bytes) {
    int len = strlen(hex);
    for (int i = 0; i < len; i += 2) {
        unsigned int byte;
        sscanf(hex + i, "%02x", &byte);
        bytes[i / 2] = (unsigned char)byte;
    }
}

// encrypt_native(plainText, key)
napi_value EncryptNative(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    // Get plainText
    size_t plain_len;
    napi_get_value_string_utf8(env, args[0], NULL, 0, &plain_len);
    char* plain = malloc(plain_len + 1);
    napi_get_value_string_utf8(env, args[0], plain, plain_len + 1, NULL);

    // Get key
    size_t key_len;
    napi_get_value_string_utf8(env, args[1], NULL, 0, &key_len);
    char* key = malloc(key_len + 1);
    napi_get_value_string_utf8(env, args[1], key, key_len + 1, NULL);

    // Encrypt (XOR with rotating key and index-based shifting to prevent pattern analysis)
    unsigned char* cipher = malloc(plain_len);
    for (size_t i = 0; i < plain_len; i++) {
        cipher[i] = (unsigned char)(plain[i] ^ key[i % key_len] ^ (i & 0xFF));
    }

    // Convert to hex
    char* hex = malloc(plain_len * 2 + 1);
    bytes_to_hex(cipher, plain_len, hex);

    napi_value result;
    napi_create_string_utf8(env, hex, strlen(hex), &result);

    free(plain);
    free(key);
    free(cipher);
    free(hex);

    return result;
}

// decrypt_native(hexCipherText, key)
napi_value DecryptNative(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    // Get hex
    size_t hex_len;
    napi_get_value_string_utf8(env, args[0], NULL, 0, &hex_len);
    char* hex = malloc(hex_len + 1);
    napi_get_value_string_utf8(env, args[0], hex, hex_len + 1, NULL);

    // Get key
    size_t key_len;
    napi_get_value_string_utf8(env, args[1], NULL, 0, &key_len);
    char* key = malloc(key_len + 1);
    napi_get_value_string_utf8(env, args[1], key, key_len + 1, NULL);

    // Convert hex to bytes
    size_t plain_len = hex_len / 2;
    unsigned char* cipher = malloc(plain_len);
    hex_to_bytes(hex, cipher);

    // Decrypt (XOR reversing)
    char* plain = malloc(plain_len + 1);
    for (size_t i = 0; i < plain_len; i++) {
        plain[i] = (char)(cipher[i] ^ key[i % key_len] ^ (i & 0xFF));
    }
    plain[plain_len] = '\0';

    napi_value result;
    napi_create_string_utf8(env, plain, plain_len, &result);

    free(hex);
    free(key);
    free(cipher);
    free(plain);

    return result;
}

// Initialize module
napi_value Init(napi_env env, napi_value exports) {
    napi_status status;
    napi_value fn_encrypt, fn_decrypt;

    status = napi_create_function(env, NULL, 0, EncryptNative, NULL, &fn_encrypt);
    if (status != napi_ok) return NULL;
    status = napi_set_named_property(env, exports, "encrypt_native", fn_encrypt);
    if (status != napi_ok) return NULL;

    status = napi_create_function(env, NULL, 0, DecryptNative, NULL, &fn_decrypt);
    if (status != napi_ok) return NULL;
    status = napi_set_named_property(env, exports, "decrypt_native", fn_decrypt);
    if (status != napi_ok) return NULL;

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
