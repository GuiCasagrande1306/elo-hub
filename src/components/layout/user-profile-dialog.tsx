"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import type { Profile } from "@/types/database";

/* =====================================================================
   Configurações de conta
   ---------------------------------------------------------------------
   DUAS FONTES DE VERDADE, e confundi-las é o erro fácil aqui:

   • `auth.users` guarda e-mail e senha — é o Supabase Auth.
   • `public.profiles` guarda nome, cargo e avatar — é o que a APLICAÇÃO
     lê e renderiza na sidebar, nas tarefas, em todo lugar.

   Gravar o nome só em `user_metadata` deixaria a tela mostrando o nome
   antigo, porque nada aqui lê metadata. Por isso nome e avatar vão para
   `profiles`, e só senha e e-mail passam pelo Auth.

   O e-mail tem uma assimetria que a interface precisa admitir: o
   Supabase só troca depois de o usuário CONFIRMAR no endereço novo.
   Até lá o login continua sendo o antigo — dizer "salvo" seria mentira.
   ===================================================================== */

export function UserProfileDialog({
  user,
  open,
  onOpenChange,
}: {
  user: Profile;
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [nome, setNome] = useState(user.full_name);
  const [email, setEmail] = useState(user.email);
  const [avatar, setAvatar] = useState(user.avatar_url);
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");

  const [salvandoGeral, setSalvandoGeral] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  const inputArquivo = useRef<HTMLInputElement>(null);

  const demo = !supabase;

  async function enviarFoto(arquivo: File) {
    if (!supabase) return;

    // O bucket recusa acima de 2MB, mas a mensagem que volta de lá é
    // técnica. Barrar aqui dá um erro que a pessoa entende.
    if (arquivo.size > 2 * 1024 * 1024) {
      toast.error("A imagem precisa ter no máximo 2MB.");
      return;
    }

    setEnviandoFoto(true);

    try {
      const extensao = arquivo.name.split(".").pop()?.toLowerCase() ?? "jpg";
      /* Caminho começa pelo id: é o que a policy do bucket usa para
         garantir que ninguém escreve na pasta de outro. O timestamp
         evita que o navegador sirva a foto antiga do cache. */
      const caminho = `${user.id}/${Date.now()}.${extensao}`;

      const { error: erroUpload } = await supabase.storage
        .from("avatars")
        .upload(caminho, arquivo, { upsert: true });

      if (erroUpload) {
        toast.error(`Erro ao enviar a imagem: ${erroUpload.message}`);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(caminho);

      const { error: erroPerfil } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);

      if (erroPerfil) {
        toast.error(`Imagem enviada, mas o perfil não atualizou: ${erroPerfil.message}`);
        return;
      }

      setAvatar(publicUrl);
      toast.success("Foto atualizada.");
      router.refresh();
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function salvarGeral() {
    if (!supabase) return;

    const nomeLimpo = nome.trim();
    if (nomeLimpo.length < 2) {
      toast.error("Informe seu nome.");
      return;
    }

    setSalvandoGeral(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: nomeLimpo })
        .eq("id", user.id);

      if (error) {
        toast.error(`Não foi possível salvar: ${error.message}`);
        return;
      }

      /* E-mail só se mudou: `updateUser` dispara e-mail de confirmação
         a cada chamada, e reenviar sem necessidade é ruído na caixa de
         quem só queria trocar o nome. */
      if (email.trim() && email.trim() !== user.email) {
        const { error: erroEmail } = await supabase.auth.updateUser({
          email: email.trim(),
        });

        if (erroEmail) {
          toast.error(`Nome salvo, mas o e-mail falhou: ${erroEmail.message}`);
          return;
        }

        toast.success(
          `Nome salvo. Confirme o novo e-mail em ${email.trim()} — o login segue sendo o antigo até lá.`,
        );
        router.refresh();
        return;
      }

      toast.success("Perfil atualizado.");
      router.refresh();
    } finally {
      setSalvandoGeral(false);
    }
  }

  async function salvarSenha() {
    if (!supabase) return;

    if (senha.length < 8) {
      toast.error("A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (senha !== confirma) {
      toast.error("As senhas não conferem.");
      return;
    }

    setSalvandoSenha(true);

    try {
      const { error } = await supabase.auth.updateUser({ password: senha });

      if (error) {
        toast.error(`Não foi possível trocar a senha: ${error.message}`);
        return;
      }

      setSenha("");
      setConfirma("");
      toast.success("Senha alterada.");
    } finally {
      setSalvandoSenha(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurações de conta</DialogTitle>
          <DialogDescription>
            Seus dados e o acesso ao sistema.
          </DialogDescription>
        </DialogHeader>

        {demo && (
          <p className="rounded-lg bg-warning-muted/40 px-3 py-2 text-xs">
            Modo demo: não há autenticação real, então as alterações não
            são gravadas.
          </p>
        )}

        <Tabs defaultValue="geral" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="geral" className="flex-1">
              Geral
            </TabsTrigger>
            <TabsTrigger value="seguranca" className="flex-1">
              Segurança
            </TabsTrigger>
          </TabsList>

          {/* ---------------- GERAL ---------------- */}
          <TabsContent value="geral" className="mt-5 flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-sm font-semibold ring-1 ring-hairline">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL do Storage é externa e variável; next/image exigiria allowlist de domínio.
                  <img
                    src={avatar}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  initials(nome || user.full_name)
                )}
              </span>

              <div>
                <input
                  ref={inputArquivo}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void enviarFoto(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={enviandoFoto || demo}
                  onClick={() => inputArquivo.current?.click()}
                >
                  {enviandoFoto ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Camera className="size-3.5" />
                  )}
                  Trocar foto
                </Button>
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  PNG, JPG ou WebP, até 2MB.
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="perfil-nome">Nome</Label>
              <Input
                id="perfil-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="perfil-email">E-mail</Label>
              <Input
                id="perfil-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5"
              />
              <p className="mt-1.5 text-2xs text-muted-foreground">
                Trocar o e-mail exige confirmação no endereço novo. Até você
                confirmar, o login continua sendo o atual.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={salvarGeral} disabled={salvandoGeral || demo}>
                {salvandoGeral && <Loader2 className="size-3.5 animate-spin" />}
                Salvar
              </Button>
            </div>
          </TabsContent>

          {/* ---------------- SEGURANÇA ---------------- */}
          <TabsContent value="seguranca" className="mt-5 flex flex-col gap-5">
            <div>
              <Label htmlFor="perfil-senha">Nova senha</Label>
              <Input
                id="perfil-senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="new-password"
                className="mt-1.5"
              />
              <p className="mt-1.5 text-2xs text-muted-foreground">
                Ao menos 8 caracteres.
              </p>
            </div>

            <div>
              <Label htmlFor="perfil-confirma">Confirmar nova senha</Label>
              <Input
                id="perfil-confirma"
                type="password"
                value={confirma}
                onChange={(e) => setConfirma(e.target.value)}
                autoComplete="new-password"
                className="mt-1.5"
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={salvarSenha} disabled={salvandoSenha || demo}>
                {salvandoSenha && <Loader2 className="size-3.5 animate-spin" />}
                Alterar senha
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
