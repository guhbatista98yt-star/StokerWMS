import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSessionQueryKey, useAuth } from "@/lib/auth";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { ArrowLeft, Users, Plus, UserCircle, Pencil } from "lucide-react";
import type { User, Section, UserSettings } from "@shared/schema";

const settingsSchema = z.object({
  canAuthorizeOwnExceptions: z.boolean().default(false),
  allowManualScanInput: z.boolean().default(true),
  viewQuickLinkBarcode: z.boolean().default(true),
  viewStockQuery: z.boolean().default(true),
});

const createUserSchema = z.object({
  username: z.string().min(3, "Mínimo 3 caracteres"),
  password: z.string().min(4, "Mínimo 4 caracteres"),
  name: z.string().min(2, "Nome obrigatório"),
  role: z.enum(["administrador", "supervisor", "separacao", "conferencia", "balcao", "fila_pedidos", "recebedor", "empilhador", "conferente_wms"]),
  sections: z.array(z.string()).optional(),
  settings: settingsSchema.optional(),
  active: z.boolean().default(true),
});

// Password is optional for updates
const updateUserSchema = createUserSchema.extend({
  password: z.string().optional(),
}).refine(data => {
  return true;
});

type CreateUserInput = z.infer<typeof createUserSchema>;
type UpdateUserInput = z.infer<typeof updateUserSchema>;

const roleLabels: Record<string, { label: string; color: string }> = {
  administrador: { label: "Administrador", color: "bg-red-100 text-red-700" },
  supervisor: { label: "Supervisor", color: "bg-purple-100 text-purple-700" },
  separacao: { label: "Separação", color: "bg-blue-100 text-blue-700" },
  conferencia: { label: "Conferência", color: "bg-teal-100 text-teal-700" },
  balcao: { label: "Balcão", color: "bg-orange-100 text-orange-700" },
  fila_pedidos: { label: "Fila de Pedidos", color: "bg-amber-100 text-amber-700" },
  recebedor: { label: "Recebedor", color: "bg-sky-100 text-sky-700" },
  empilhador: { label: "Empilhador", color: "bg-indigo-100 text-indigo-700" },
  conferente_wms: { label: "Conferente WMS", color: "bg-emerald-100 text-emerald-700" },
};

export default function UsersPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const usersQueryKey = useSessionQueryKey(["/api/users"]);

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: usersQueryKey,
  });

  const { data: availableSections } = useQuery<Section[]>({
    queryKey: ["/api/sections"],
  });

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      username: "",
      password: "",
      name: "",
      role: "separacao",
      sections: [],
      settings: {
        canAuthorizeOwnExceptions: false,
        allowManualScanInput: true,
        viewQuickLinkBarcode: true,
        viewStockQuery: true,
      },
      active: true,
    },
  });

  const editForm = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      username: "",
      password: "",
      name: "",
      role: "separacao",
      sections: [],
      settings: {
        canAuthorizeOwnExceptions: false,
        allowManualScanInput: true,
        viewQuickLinkBarcode: true,
        viewStockQuery: true,
      },
      active: true,
    },
  });

  const createRole = form.watch("role");
  const editRole = editForm.watch("role");
  const isAdmin = user?.role === "administrador";

  // Reset edit form when editingUser changes
  useEffect(() => {
    if (editingUser) {
      const userSettings = (editingUser.settings as UserSettings) || {};
      editForm.reset({
        username: editingUser.username,
        password: "", // Don't show current password
        name: editingUser.name,
        role: editingUser.role as any,
        sections: (editingUser.sections as string[]) || [],
        settings: {
          canAuthorizeOwnExceptions: userSettings.canAuthorizeOwnExceptions ?? false,
          allowManualScanInput: (userSettings as any).allowManualScanInput ?? true,
          viewQuickLinkBarcode: (userSettings as any).viewQuickLinkBarcode ?? true,
          viewStockQuery: (userSettings as any).viewStockQuery ?? true,
        },
        active: editingUser.active,
      });
    }
  }, [editingUser, editForm]);

  const createUserMutation = useMutation({
    mutationFn: async (data: CreateUserInput) => {
      const res = await apiRequest("POST", "/api/users", data);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Falha ao criar usuário");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersQueryKey });
      setShowCreateDialog(false);
      form.reset();
      toast({
        title: "Usuário criado",
        description: "O novo usuário foi cadastrado com sucesso",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Erro ao criar usuário",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async (data: UpdateUserInput) => {
      if (!editingUser) return;
      const res = await apiRequest("PATCH", `/api/users/${editingUser.id}`, data);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Falha ao atualizar usuário");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersQueryKey });
      setEditingUser(null);
      editForm.reset();
      toast({
        title: "Usuário atualizado",
        description: "As alterações foram salvas com sucesso",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Erro ao atualizar usuário",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateUserInput) => {
    createUserMutation.mutate(data);
  };

  const onUpdateSubmit = (data: UpdateUserInput) => {
    updateUserMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Usuários</h1>
            <p className="text-xs text-muted-foreground">Gerenciar operadores do sistema</p>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div className="flex justify-end">
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-user">
            <Plus className="h-4 w-4 mr-2" />
            Novo Usuário
          </Button>
        </div>

        <SectionCard title="Usuários Cadastrados" icon={<Users className="h-4 w-4 text-primary" />}>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users && users.length > 0 ? (
            <div className="overflow-x-auto -mx-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead className="hidden sm:table-cell">Usuário</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead className="hidden md:table-cell">Seções</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Permissões</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => {
                    const roleConfig = roleLabels[user.role] || {
                      label: user.role,
                      color: "bg-gray-100 text-gray-700",
                    };
                    const userSections = (user.sections as string[]) || [];

                    return (
                      <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-2 sm:gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <UserCircle className="h-5 w-5 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <span className="font-medium block truncate">{user.name}</span>
                              <span className="text-xs text-muted-foreground font-mono sm:hidden">{user.username}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono hidden sm:table-cell">{user.username}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`${roleConfig.color} border-0`}>
                            {roleConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {userSections.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {userSections.slice(0, 3).map((s, i) => {
                                const secName = availableSections?.find(sec => String(sec.id) === s)?.name || s;
                                return (
                                  <Badge key={i} variant="secondary" className="text-xs">
                                    {secName}
                                  </Badge>
                                )
                              })}
                              {userSections.length > 3 && (
                                <Badge variant="secondary" className="text-xs">
                                  +{userSections.length - 3}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs italic">Nenhuma</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.active ? (
                            <Badge variant="outline" className="bg-green-100 text-green-700 border-0">
                              Ativo
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-100 text-gray-700 border-0">
                              Inativo
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {(() => {
                            const settings = (user.settings as UserSettings) || {};
                            const hasBadges = settings.allowMultiplier || settings.canAuthorizeOwnExceptions;
                            return hasBadges ? (
                              <div className="flex flex-wrap gap-1">
                                {settings.allowMultiplier && (
                                  <Badge variant="outline" className="bg-blue-100 text-blue-700 border-0 text-xs">
                                    Mult
                                  </Badge>
                                )}
                                {settings.canAuthorizeOwnExceptions && (
                                  <Badge variant="outline" className="bg-green-100 text-green-700 border-0 text-xs">
                                    Auto-Exc
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">—</span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingUser(user)}
                            className="hover:bg-primary/10 hover:text-primary"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-16 w-16 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium">Nenhum usuário cadastrado</p>
              <p className="text-sm">Crie o primeiro usuário do sistema</p>
            </div>
          )}
        </SectionCard>
      </main>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Usuário</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome Completo</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Nome do operador" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Usuário</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Login de acesso" data-testid="input-username" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="Senha de acesso"
                        data-testid="input-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Perfil</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-role">
                          <SelectValue placeholder="Selecione o perfil" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {isAdmin && <SelectItem value="administrador">Administrador</SelectItem>}
                        <SelectItem value="supervisor">Supervisor</SelectItem>
                        <SelectItem value="separacao">Separação</SelectItem>
                        <SelectItem value="conferencia">Conferência</SelectItem>
                        <SelectItem value="balcao">Balcão</SelectItem>
                        <SelectItem value="fila_pedidos">Fila de Pedidos</SelectItem>
                        <SelectItem value="recebedor">Recebedor</SelectItem>
                        <SelectItem value="empilhador">Empilhador</SelectItem>
                        <SelectItem value="conferente_wms">Conferente WMS</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {createRole === "separacao" && (
                <FormField
                  control={form.control}
                  name="sections"
                  render={() => (
                    <FormItem>
                      <div className="mb-4">
                        <FormLabel className="text-base">Seções (Opcional)</FormLabel>
                        <FormDescription>
                          Selecione as seções que este usuário poderá acessar.
                        </FormDescription>
                      </div>
                      {availableSections && availableSections.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 border rounded-md p-2 max-h-40 overflow-y-auto">
                          {availableSections.map((section) => {
                            const sectionValue = String(section.id);
                            return (
                              <FormField
                                key={section.id}
                                control={form.control}
                                name="sections"
                                render={({ field }) => (
                                  <FormItem
                                    className="flex flex-row items-start space-x-3 space-y-0"
                                  >
                                    <FormControl>
                                      <Checkbox
                                        checked={field.value?.includes(sectionValue)}
                                        onCheckedChange={(checked) => {
                                          return checked
                                            ? field.onChange([...(field.value || []), sectionValue])
                                            : field.onChange(
                                              field.value?.filter(
                                                (value) => value !== sectionValue
                                              )
                                            )
                                        }}
                                      />
                                    </FormControl>
                                    <FormLabel className="font-normal cursor-pointer text-xs">
                                      <span className="font-mono font-bold mr-1">{section.id}</span>
                                      {section.name}
                                    </FormLabel>
                                  </FormItem>
                                )}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground p-2 border rounded bg-muted/20">
                          Nenhuma seção encontrada. Sincronize o banco para carregar as seções.
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {(createRole === "separacao" || createRole === "conferencia" || createRole === "balcao") && (
                <>
                  <FormField
                    control={form.control}
                    name="settings.canAuthorizeOwnExceptions"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Auto-autorizar Exceções</FormLabel>
                          <FormDescription>
                            Permite autorizar suas próprias exceções
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? false}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="settings.allowManualScanInput"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Permitir digitação manual</FormLabel>
                          <FormDescription>
                            Quando desativado, somente leitura por scanner é aceita.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? true}
                            onCheckedChange={field.onChange}
                            data-testid="switch-allow-manual-scan-create"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="settings.viewQuickLinkBarcode"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Visualizar Vínculo Rápido</FormLabel>
                          <FormDescription>
                            Exibe o atalho para vincular código de embalagem.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? true}
                            onCheckedChange={field.onChange}
                            data-testid="switch-view-quicklink-create"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="settings.viewStockQuery"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Visualizar Consulta de Estoque</FormLabel>
                          <FormDescription>
                            Exibe o botão de consulta de estoque dentro da operação.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? true}
                            onCheckedChange={field.onChange}
                            data-testid="switch-view-stock-create"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </>
              )}
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-submit">
                  Criar Usuário
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onUpdateSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome Completo</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Nome do operador" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Usuário</FormLabel>
                    <FormControl>
                      <Input {...field} disabled className="bg-muted" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nova Senha (Opcional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="Deixe em branco para manter a atual"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Perfil</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o perfil" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {isAdmin && <SelectItem value="administrador">Administrador</SelectItem>}
                        <SelectItem value="supervisor">Supervisor</SelectItem>
                        <SelectItem value="separacao">Separação</SelectItem>
                        <SelectItem value="conferencia">Conferência</SelectItem>
                        <SelectItem value="balcao">Balcão</SelectItem>
                        <SelectItem value="fila_pedidos">Fila de Pedidos</SelectItem>
                        <SelectItem value="recebedor">Recebedor</SelectItem>
                        <SelectItem value="empilhador">Empilhador</SelectItem>
                        <SelectItem value="conferente_wms">Conferente WMS</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel>Usuário Ativo</FormLabel>
                      <FormDescription>
                        Desativar para bloquear acesso
                      </FormDescription>
                    </div>
                    <FormControl>
                      {user && user.id === editingUser?.id ? (
                        <div title="Você não pode desativar seu próprio usuário" className="cursor-not-allowed">
                          <Switch checked={true} disabled />
                        </div>
                      ) : (
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    </FormControl>
                  </FormItem>
                )}
              />
              {editRole === "separacao" && (
                <FormField
                  control={editForm.control}
                  name="sections"
                  render={() => (
                    <FormItem>
                      <div className="mb-4">
                        <FormLabel className="text-base">Seções</FormLabel>
                        <FormDescription>
                          Selecione as seções que este usuário poderá acessar.
                        </FormDescription>
                      </div>
                      {availableSections && availableSections.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 border rounded-md p-2 max-h-40 overflow-y-auto">
                          {availableSections.map((section) => {
                            const sectionValue = String(section.id);
                            return (
                              <FormField
                                key={section.id}
                                control={editForm.control}
                                name="sections"
                                render={({ field }) => (
                                  <FormItem
                                    className="flex flex-row items-start space-x-3 space-y-0"
                                  >
                                    <FormControl>
                                      <Checkbox
                                        checked={field.value?.includes(sectionValue)}
                                        onCheckedChange={(checked) => {
                                          return checked
                                            ? field.onChange([...(field.value || []), sectionValue])
                                            : field.onChange(
                                              field.value?.filter(
                                                (value) => value !== sectionValue
                                              )
                                            )
                                        }}
                                      />
                                    </FormControl>
                                    <FormLabel className="font-normal cursor-pointer text-xs">
                                      <span className="font-mono font-bold mr-1">{section.id}</span>
                                      {section.name}
                                    </FormLabel>
                                  </FormItem>
                                )}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground p-2 border rounded bg-muted/20">
                          Nenhuma seção encontrada.
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {(editRole === "separacao" || editRole === "conferencia" || editRole === "balcao") && (
                <>
                  <FormField
                    control={editForm.control}
                    name="settings.canAuthorizeOwnExceptions"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Auto-autorizar Exceções</FormLabel>
                          <FormDescription>
                            Permite autorizar suas próprias exceções
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? false}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="settings.allowManualScanInput"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Permitir digitação manual</FormLabel>
                          <FormDescription>
                            Quando desativado, somente leitura por scanner é aceita.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? true}
                            onCheckedChange={field.onChange}
                            data-testid="switch-allow-manual-scan-edit"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="settings.viewQuickLinkBarcode"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Visualizar Vínculo Rápido</FormLabel>
                          <FormDescription>
                            Exibe o atalho para vincular código de embalagem.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? true}
                            onCheckedChange={field.onChange}
                            data-testid="switch-view-quicklink-edit"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="settings.viewStockQuery"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Visualizar Consulta de Estoque</FormLabel>
                          <FormDescription>
                            Exibe o botão de consulta de estoque dentro da operação.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? true}
                            onCheckedChange={field.onChange}
                            data-testid="switch-view-stock-edit"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </>
              )}
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={!editForm.formState.isDirty || updateUserMutation.isPending}>
                  Salvar Alterações
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
