import js from "@eslint/js";
import nodePlugin from "eslint-plugin-n"; // Correct import
import securityPlugin from "eslint-plugin-security";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
    {
        ignores: [
            "config/database.js",
            "eslint.config.js",
            "index.js",
            "routes/Login.js",
            "routes/Security.js",
            "routes/WorkSubmission.js",
            "routes/admin.js",
            "routes/bucketSending.js",
            "routes/client.js",
            "routes/freelancer.js",
            "routes/payment.js"
          ]
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.node, // Node.js globals
            },
        },
        plugins: {
            n: nodePlugin, // Use 'n' as the plugin name
            security: securityPlugin,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...nodePlugin.configs.recommended.rules, // Use nodePlugin.configs
            ...prettier.rules,
            "security/detect-object-injection": "error",
        },
    },
];