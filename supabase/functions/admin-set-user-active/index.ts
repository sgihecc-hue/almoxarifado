// Desativar / reativar usuário pelo administrador (tela Usuários).
// Auditoria 28/09/2026, X-09.
//
// Antes o "Desativar" só gravava users.deleted_at pelo navegador: a conta
// continuava entrando (ninguém bania no GoTrue e o app não olhava deleted_at),
// e "Reativar" chamava a mesma função de desativar.
//
// Agora, numa chamada só e com service_role:
//   1. bane (ban_duration longo) ou desbane ('none') a conta no GoTrue — o
//      banido não entra nem renova o token;
//   2. marca public.users.is_active e deleted_at (o app recusa o perfil
//      inativo ao abrir, mesmo que um token antigo ainda esteja valendo).
// Se o passo 2 falhar, o passo 1 é desfeito.
//
// Autorização no padrão da admin-create-user: token válido E perfil
// 'administrador' em public.users. Ninguém desativa a si mesmo nem o último
// administrador ativo.
//
// Corpo: { "userId": "<uuid>", "active": true | false }
import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ~100 anos: o GoTrue aceita duração em horas.
const BAN_LONGO = "876000h";

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return resposta(405, { error: "Método não permitido" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return resposta(401, { error: "Não autenticado." });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 1. quem chama: token válido...
    const { data: { user: chamador }, error: erroUsuario } = await admin.auth.getUser(
      authHeader.replace(/^Bearer\s+/i, ""),
    );
    if (erroUsuario || !chamador) return resposta(401, { error: "Sessão inválida. Entre novamente." });

    // ...e administrador ativo
    const { data: perfilChamador, error: erroPerfil } = await admin
      .from("users").select("role, is_active, deleted_at").eq("id", chamador.id).single();
    if (erroPerfil || !perfilChamador || perfilChamador.role !== "administrador" ||
        perfilChamador.is_active === false || perfilChamador.deleted_at) {
      return resposta(403, { error: "Somente administradores podem ativar ou desativar usuários." });
    }

    // 2. corpo
    let corpo: Record<string, unknown>;
    try {
      corpo = await req.json();
    } catch {
      return resposta(400, { error: "Corpo da requisição inválido." });
    }
    const userId = String(corpo.userId ?? "").trim();
    const ativo = corpo.active;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return resposta(400, { error: "Usuário inválido." });
    if (typeof ativo !== "boolean") return resposta(400, { error: "Informe active: true ou false." });

    if (!ativo && userId === chamador.id) {
      return resposta(400, { error: "Você não pode desativar o seu próprio usuário." });
    }

    const { data: alvo, error: erroAlvo } = await admin
      .from("users").select("id, full_name, role, is_active, deleted_at").eq("id", userId).maybeSingle();
    if (erroAlvo) return resposta(500, { error: `Erro ao ler o usuário: ${erroAlvo.message}` });
    if (!alvo) return resposta(404, { error: "Usuário não encontrado." });

    if (!ativo && alvo.role === "administrador") {
      const { count } = await admin
        .from("users").select("id", { count: "exact", head: true })
        .eq("role", "administrador").is("deleted_at", null).neq("is_active", false);
      if ((count ?? 0) <= 1) return resposta(400, { error: "Não é possível desativar o último administrador ativo." });
    }

    // 3. GoTrue: bane / desbane
    const { error: erroBan } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: ativo ? "none" : BAN_LONGO,
    });
    if (erroBan) {
      return resposta(500, { error: `Não foi possível ${ativo ? "liberar" : "bloquear"} o login: ${erroBan.message}` });
    }

    // 4. perfil
    const { data: atualizado, error: erroUpd } = await admin
      .from("users")
      .update({ is_active: ativo, deleted_at: ativo ? null : new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id, is_active, deleted_at")
      .maybeSingle();
    if (erroUpd || !atualizado) {
      // desfaz o passo 3 para não ficar metade feito
      await admin.auth.admin.updateUserById(userId, {
        ban_duration: alvo.is_active === false || alvo.deleted_at ? BAN_LONGO : "none",
      });
      return resposta(500, { error: `Falha ao gravar o cadastro (${erroUpd?.message ?? "sem retorno"}). Nada foi alterado.` });
    }

    return resposta(200, { user: atualizado });
  } catch (e) {
    return resposta(500, { error: `Erro interno: ${e instanceof Error ? e.message : String(e)}` });
  }
});
