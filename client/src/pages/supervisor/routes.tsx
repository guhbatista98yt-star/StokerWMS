import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { ArrowLeft, Map, Plus, Pencil, Trash2, Search, X, CircleCheck, CircleOff } from "lucide-react";
import type { Route } from "@shared/schema";

const routeSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(2, "Nome obrigatório"),
  description: z.string().optional(),
  active: z.boolean().default(true),
});

type RouteInput = z.infer<typeof routeSchema>;

export default function RoutesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [routeToDeactivate, setRouteToDeactivate] = useState<Route | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: routes, isLoading } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
  });

  const form = useForm<RouteInput>({
    resolver: zodResolver(routeSchema),
    defaultValues: { name: "", code: "", description: "", active: true },
  });

  const editForm = useForm<RouteInput>({
    resolver: zodResolver(routeSchema),
    defaultValues: { name: "", code: "", description: "", active: true },
  });

  const createRouteMutation = useMutation({
    mutationFn: async (data: RouteInput) => {
      const res = await apiRequest("POST", "/api/routes", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      setShowCreateDialog(false);
      form.reset();
      toast({ title: "Rota criada", description: "Nova rota cadastrada com sucesso" });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao criar rota",
        description: error.message.includes("400") ? "Verifique os campos obrigatórios." : error.message,
        variant: "destructive",
      });
    },
  });

  const updateRouteMutation = useMutation({
    mutationFn: async (data: RouteInput) => {
      if (!editingRoute) return;
      const res = await apiRequest("PATCH", `/api/routes/${editingRoute.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      setEditingRoute(null);
      editForm.reset();
      toast({ title: "Rota atualizada", description: "Alterações salvas com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao atualizar rota", variant: "destructive" });
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/routes/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({ title: "Rota desativada" });
    },
  });

  function handleEdit(route: Route) {
    setEditingRoute(route);
    editForm.reset({
      code: route.code || "",
      name: route.name,
      description: route.description || "",
      active: route.active,
    });
  }

  const filtered = useMemo(() => {
    if (!routes) return [];
    return routes.filter(r => {
      const q = search.toLowerCase();
      const matchSearch = !q || r.name.toLowerCase().includes(q) || (r.code || "").toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q);
      const matchStatus = statusFilter === "all" || (statusFilter === "active" ? r.active : !r.active);
      return matchSearch && matchStatus;
    });
  }, [routes, search, statusFilter]);

  const activeCount = routes?.filter(r => r.active).length ?? 0;
  const inactiveCount = routes?.filter(r => !r.active).length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-foreground leading-tight">Gestão de Rotas</h1>
          <p className="text-xs text-muted-foreground">Cadastre e gerencie as rotas de entrega</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-route-search"
              placeholder="Buscar por código ou nome..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 rounded-xl h-9"
            />
            {search && (
              <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] rounded-xl h-9" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos ({routes?.length ?? 0})</SelectItem>
              <SelectItem value="active">Ativas ({activeCount})</SelectItem>
              <SelectItem value="inactive">Inativas ({inactiveCount})</SelectItem>
            </SelectContent>
          </Select>
          <Button className="rounded-xl h-9 gap-1.5" onClick={() => setShowCreateDialog(true)} data-testid="button-new-route">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nova Rota</span>
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-14 text-muted-foreground">
              <Map className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">{routes?.length === 0 ? "Nenhuma rota cadastrada" : "Nenhuma rota encontrada"}</p>
              <p className="text-sm mt-1">{routes?.length === 0 ? "Crie a primeira rota para começar" : "Tente ajustar a busca ou filtro"}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-[90px]">Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden md:table-cell">Descrição</TableHead>
                  <TableHead className="w-[90px]">Status</TableHead>
                  <TableHead className="w-[80px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(route => (
                  <TableRow key={route.id} className="group">
                    <TableCell className="font-mono text-xs text-muted-foreground">{route.code || "—"}</TableCell>
                    <TableCell className="font-medium text-sm">{route.name}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{route.description || "—"}</TableCell>
                    <TableCell>
                      {route.active ? (
                        <Badge variant="outline" className="gap-1 text-xs border-green-200 bg-green-50 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400">
                          <CircleCheck className="h-3 w-3" />Ativa
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-xs border-border bg-muted/50 text-muted-foreground">
                          <CircleOff className="h-3 w-3" />Inativa
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/10 hover:text-primary" onClick={() => handleEdit(route)} data-testid={`button-edit-route-${route.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/30 dark:hover:text-red-400 ${!route.active ? "opacity-40 pointer-events-none" : ""}`}
                          onClick={() => {
                            if (route.active) setRouteToDeactivate(route);
                          }}
                          data-testid={`button-delete-route-${route.id}`}
                          title={!route.active ? "Rota já inativa" : "Desativar rota"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {!isLoading && filtered.length > 0 && (
          <p className="text-xs text-muted-foreground text-right px-1">
            {filtered.length} rota{filtered.length !== 1 ? "s" : ""}{search || statusFilter !== "all" ? " encontrada" + (filtered.length !== 1 ? "s" : "") : " no total"}
          </p>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Rota</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(data => createRouteMutation.mutate(data))} className="space-y-4">
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Código <span className="text-muted-foreground font-normal">(opcional)</span></FormLabel>
                  <FormControl><Input {...field} placeholder="Ex: 001, SUL" /></FormControl>
                  <FormDescription className="text-xs">Deixe em branco para gerar automaticamente.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da Rota</FormLabel>
                  <FormControl><Input {...field} placeholder="Ex: Rota Sul, Rota 1" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição <span className="text-muted-foreground font-normal">(opcional)</span></FormLabel>
                  <FormControl><Input {...field} placeholder="Detalhes adicionais" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>Cancelar</Button>
                <Button type="submit" disabled={createRouteMutation.isPending}>Criar Rota</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Deactivate Route Confirmation */}
      <AlertDialog open={!!routeToDeactivate} onOpenChange={open => !open && setRouteToDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar rota</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja desativar a rota <strong>{routeToDeactivate?.name}</strong>? Ela não estará disponível para seleção em novos pedidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                if (routeToDeactivate) {
                  deleteRouteMutation.mutate(routeToDeactivate.id);
                  setRouteToDeactivate(null);
                }
              }}
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingRoute} onOpenChange={open => !open && setEditingRoute(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Rota</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(data => updateRouteMutation.mutate(data))} className="space-y-4">
              <FormField control={editForm.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Código</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da Rota</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="active" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                  <div>
                    <FormLabel className="text-sm font-medium">Rota Ativa</FormLabel>
                    <FormDescription className="text-xs">Desativar para ocultar da seleção</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />
              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setEditingRoute(null)}>Cancelar</Button>
                <Button type="submit" disabled={!editForm.formState.isDirty || updateRouteMutation.isPending}>Salvar</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
