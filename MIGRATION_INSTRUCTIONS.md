# 🔧 Instruções para Corrigir os Erros do Sistema

## 📝 Resumo dos Problemas

Seu sistema está apresentando dois erros críticos:

1. **Erro de Coluna Inexistente**: `column warehouse_items.is_active does not exist`
2. **Erro de Chave Duplicada**: `duplicate key value violates unique constraint "warehouse_items_code_key"`

## ✅ Solução (3 Passos Simples)

### **Passo 1: Abrir o SQL Editor do Supabase**

1. Acesse o Supabase Dashboard: https://ojcpmwjejituqvjappxy.supabase.co
2. Faça login com suas credenciais
3. No menu lateral esquerdo, clique em **"SQL Editor"**

### **Passo 2: Executar a Migração**

1. Abra o arquivo `fix_is_active_migration.sql` (na raiz do projeto)
2. Copie **TODO** o conteúdo do arquivo
3. Cole no SQL Editor do Supabase
4. Clique no botão **"Run"** (canto inferior direito)
5. Aguarde a confirmação de sucesso

### **Passo 3: Verificar o Resultado**

Após executar a migração, você verá uma mensagem de confirmação:

```
✓ warehouse_items.is_active exists: true
✓ pharmacy_items.is_active exists: true
✓ Inactive warehouse items: 1
```

## 🎯 O Que Esta Migração Faz

### **1. Adiciona Coluna `is_active`**
- Cria a coluna `is_active` nas tabelas `warehouse_items` e `pharmacy_items`
- Define o valor padrão como `true` para todos os itens
- Permite ativar/inativar itens sem deletá-los

### **2. Resolve Conflitos de Código Duplicado**
- Marca o item com código `65.02.19.00099934-2` como inativo
- Isso permite que você crie um novo item com o mesmo código
- O item antigo permanece no banco para histórico

### **3. Melhora Performance**
- Cria índices para consultas mais rápidas
- Otimiza filtros de itens ativos

## 🔍 Como Funciona o Sistema de Ativação/Inativação

### **Antes (Deletava Itens)**
```
Deletar item → ❌ Perda permanente de dados
              → ❌ Não pode ser revertido
              → ❌ Perde histórico
```

### **Depois (Inativa Itens)**
```
Inativar item → ✅ Dados preservados
              → ✅ Pode ser reativado
              → ✅ Mantém histórico completo
```

## 📱 Como Usar no Sistema

### **Inativar um Item**
1. Acesse a página de Inventário (Almoxarifado ou Farmácia)
2. Clique nos 3 pontinhos do item
3. Selecione "Editar Estoque"
4. Digite a senha "coruja"
5. Desmarque o switch "Item Ativo"
6. Clique em "Salvar Alterações"

### **Reativar um Item**
- Siga os mesmos passos acima
- Marque o switch "Item Ativo"
- O item voltará a aparecer nas listagens

## 🚨 Problemas Comuns e Soluções

### **Erro: "permission denied"**
- **Causa**: Você não tem permissão de administrador no banco
- **Solução**: Use a conta do proprietário do projeto Supabase

### **Erro: "relation already exists"**
- **Causa**: A migração já foi executada anteriormente
- **Solução**: Isso é normal, a migração é idempotente (segura para executar múltiplas vezes)

### **Sistema ainda mostra erro após migração**
- **Solução**: Recarregue a página do aplicativo (F5 ou Ctrl+R)

## 📞 Próximos Passos

Após executar a migração:

1. ✅ Os erros de `is_active` serão resolvidos
2. ✅ Você poderá criar novos itens sem conflitos de código
3. ✅ Poderá inativar/reativar itens através do sistema
4. ✅ Todos os itens existentes permanecerão ativos

## 🔐 Segurança

- A migração é **reversível**
- Não deleta **nenhum dado**
- Mantém todas as **políticas RLS** existentes
- É **idempotente** (segura para executar múltiplas vezes)

---

**Dúvidas?** Consulte o plano de ação completo no início desta conversa.
