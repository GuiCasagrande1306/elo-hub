"use client";

import * as React from "react";
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/* =====================================================================
   Primitivos de formulário
   ---------------------------------------------------------------------
   Escritos à mão porque o estilo `base-nova` do shadcn NÃO publica um
   componente `form`: o registro existe mas vem sem arquivos
   (`npx shadcn view @shadcn/form` devolve só o nome), e por isso o
   `add` falha em silêncio.

   A API é a canônica do shadcn — Form, FormField, FormItem, FormLabel,
   FormControl, FormDescription, FormMessage — para que qualquer exemplo
   da documentação funcione aqui sem tradução.

   O que esses wrappers realmente entregam é acessibilidade que ninguém
   escreve à mão de forma consistente: `htmlFor` ligando label ao campo,
   `aria-describedby` apontando para descrição E erro, e `aria-invalid`
   alternando sozinho. Sem isso, um leitor de tela anuncia "Nome" e não
   diz que o campo está inválido nem por quê.
   ===================================================================== */

const Form = FormProvider;

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName;
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

interface FormItemContextValue {
  id: string;
}

const FormItemContext = React.createContext<FormItemContextValue | null>(null);

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext?.name as string });

  if (!fieldContext) {
    throw new Error("useFormField precisa estar dentro de <FormField>.");
  }
  if (!itemContext) {
    throw new Error("useFormField precisa estar dentro de <FormItem>.");
  }

  const fieldState = getFieldState(fieldContext.name, formState);
  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  // `useId` garante ids únicos mesmo com o mesmo formulário renderizado
  // duas vezes na página — o que acontece quando um Sheet fica montado
  // junto com a versão inline.
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    </FormItemContext.Provider>
  );
}

function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField();

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

/**
 * Repassa id e atributos ARIA ao campo filho.
 *
 * Usa `useRender` do Base UI — o mesmo mecanismo do `render` que os
 * outros componentes do projeto usam — em vez do `Slot` do Radix, que
 * não é dependência daqui.
 */
function FormControl({
  render,
  ...props
}: useRender.ComponentProps<"input"> & {
  render: useRender.RenderProp<Record<string, unknown>>;
}) {
  const { error, formItemId, formDescriptionId, formMessageId } =
    useFormField();

  return useRender({
    render,
    props: mergeProps<"input">(
      {
        id: formItemId,
        // Aponta para a descrição sempre, e para a mensagem de erro só
        // quando ela existe — apontar para um id inexistente faz o
        // leitor de tela ignorar o atributo inteiro.
        "aria-describedby": error
          ? `${formDescriptionId} ${formMessageId}`
          : formDescriptionId,
        "aria-invalid": !!error,
      },
      props,
    ),
  });
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : props.children;

  if (!body) return null;

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      // `role="alert"` faz o leitor de tela anunciar o erro no momento
      // em que ele aparece, sem o usuário precisar navegar até o campo.
      role="alert"
      className={cn("text-xs font-medium text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
