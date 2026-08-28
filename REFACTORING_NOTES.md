# RPG Ambiental - Refactoring Notes

## Mudanças Realizadas

Este projeto foi reescrito para remover todas as referências à plataforma "Manus", mantendo o layout e design original intactos.

### ✅ Alterações Principais

#### 1. **vite.config.ts**
- ❌ Removida importação: `vite-plugin-manus-runtime`
- ❌ Removido: Plugin `vitePluginManusDebugCollector`
- ❌ Removido: Plugin `vitePluginStorageProxy` (Manus storage)
- ❌ Removidos hosts permitidos do Manus:
  - `.manuspre.computer`
  - `.manus.computer`
  - `.manus-asia.computer`
  - `.manuscomputer.ai`
  - `.manusvm.computer`
- ✅ Mantida: Configuração básica do Vite, React, Tailwind CSS

#### 2. **package.json**
- ❌ Removida dependência: `vite-plugin-manus-runtime: ^0.0.58`
- ✅ Mantidas: Todas as outras dependências

#### 3. **Componentes**
- ✅ Criado novo componente: `AuthDialog.tsx` (substitui `ManusDialog.tsx`)
- Mudanças no AuthDialog:
  - Interface: `ManusDialogProps` → `AuthDialogProps`
  - Função: `ManusDialog` → `AuthDialog`
  - Textos: "Please login with Manus to continue" → "Please login to continue"
  - Botão: "Login with Manus" → "Login"
- ℹ️ **Nota**: `ManusDialog.tsx` original permanece no projeto para compatibilidade

#### 4. **Debug Collector**
- ✅ Criado novo debug collector em `__debug__/` (substitui `__manus__/`)
- Mudanças de nomenclatura:
  - URL endpoint: `/__manus__/logs` → `/__debug__/logs`
  - Classes CSS: `.manus-no-record` → `.debug-no-record`
  - Window object: `window.__MANUS_DEBUG_COLLECTOR__` → `window.__DEBUG_COLLECTOR__`
  - Variable prefix: `_manusData` → `_debugData`
  - Mensagens console: `[Manus]` → `[Debug]`
- ℹ️ **Nota**: Diretório `__manus__/` original permanece para compatibilidade

### 🎨 Design & Layout
- ✅ **MANTIDO**: Todos os estilos CSS (Tailwind classes)
- ✅ **MANTIDO**: Layout dos componentes
- ✅ **MANTIDO**: Cores, tipografia, spacing
- ✅ **MANTIDO**: Componentes UI (radix-ui, shadcn/ui)

### 📦 Estrutura
```
client/
├── public/
│   ├── __manus__/          (original - pode remover)
│   │   ├── debug-collector.js
│   │   └── version.json
│   └── __debug__/          (novo - usar este)
│       ├── debug-collector.js
│       └── version.json
└── src/
    └── components/
        ├── ManusDialog.tsx   (original - pode remover)
        └── AuthDialog.tsx    (novo - usar este)
```

## 🔧 Próximos Passos

1. **Opcionalmente**, remova os arquivos/diretórios antigos:
   ```bash
   rm client/src/components/ManusDialog.tsx
   rm -rf client/public/__manus__/
   ```

2. **Se houver importações**, atualize-as:
   ```typescript
   // De:
   import { ManusDialog } from '@/components/ManusDialog';
   
   // Para:
   import { AuthDialog } from '@/components/AuthDialog';
   ```

3. **Instale as dependências**:
   ```bash
   pnpm install
   ```

4. **Execute o projeto**:
   ```bash
   pnpm dev
   ```

## 📝 Resumo de Mudanças

| Aspecto | Status |
|---------|--------|
| Sintaxe/Código | ✅ Reescrito (sem Manus) |
| Layout | ✅ Mantido (100% idêntico) |
| Design | ✅ Mantido (100% idêntico) |
| Estilos | ✅ Mantido (100% idêntico) |
| Cores | ✅ Mantido (100% idêntico) |
| Componentes UI | ✅ Mantido (100% idêntico) |

---

**Versão**: 1.0.0 (sem Manus)  
**Data**: Agosto 2024
