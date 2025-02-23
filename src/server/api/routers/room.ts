import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";

export const roomRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session?.user?.id) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to create a room',
        });
      }

      try {
        // Log session info
        console.log('Session:', {
          id: ctx.session.user.id,
          name: ctx.session.user.name,
          email: ctx.session.user.email
        });

        // Check if user exists
        const user = await ctx.prisma.user.findUnique({
          where: { id: ctx.session.user.id },
        });
        
        console.log('Found user:', user);

        if (!user) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `User not found with id: ${ctx.session.user.id}`,
          });
        }

        // Create room
        const room = await ctx.prisma.room.create({
          data: {
            name: input.name ?? 'New Room',
            ownerId: user.id,
            participants: {
              connect: { id: user.id }
            }
          }
        });

        // Now fetch the room with participants
        const roomWithParticipants = await ctx.prisma.room.findUnique({
          where: { id: room.id },
          include: {
            participants: true,
            owner: true,
          },
        });

        if (!roomWithParticipants) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Room was created but could not be fetched',
          });
        }
        
        console.log('Room created:', roomWithParticipants);
        return roomWithParticipants;

      } catch (error) {
        console.error('Room creation error:', error);
        if (error instanceof Error) {
          console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
          });
        }
        // If it's already a TRPC error, rethrow it
        if (error instanceof TRPCError) {
          throw error;
        }
        // Otherwise wrap it in a TRPC error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create room',
          cause: error,
        });
      }
    }),

  join: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const room = await ctx.prisma.room.update({
        where: { id: input.roomId },
        data: {
          participants: {
            connect: { id: ctx.session.user.id },
          },
        },
        include: {
          participants: true,
        },
      });
      return room;
    }),

  leave: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const room = await ctx.prisma.room.update({
        where: { id: input.roomId },
        data: {
          participants: {
            disconnect: { id: ctx.session.user.id },
          },
        },
      });
      return room;
    }),

  updateUrl: protectedProcedure
    .input(z.object({ roomId: z.string(), url: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const room = await ctx.prisma.room.findUnique({
        where: { id: input.roomId },
        include: { participants: true },
      });

      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }

      if (!room.participants.some((p) => p.id === ctx.session.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a participant in this room",
        });
      }

      return ctx.prisma.room.update({
        where: { id: input.roomId },
        data: { currentUrl: input.url },
      });
    }),

  sendMessage: protectedProcedure
    .input(z.object({ roomId: z.string(), text: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const room = await ctx.prisma.room.findUnique({
        where: { id: input.roomId },
        include: { participants: true },
      });

      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }

      if (!room.participants.some((p) => p.id === ctx.session.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a participant in this room",
        });
      }

      return ctx.prisma.message.create({
        data: {
          text: input.text,
          roomId: input.roomId,
          userId: ctx.session.user.id,
        },
      });
    }),

  getMessages: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .query(async ({ ctx, input }) => {
      const room = await ctx.prisma.room.findUnique({
        where: { id: input.roomId },
        include: { participants: true },
      });

      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }

      if (!room.participants.some((p) => p.id === ctx.session.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a participant in this room",
        });
      }

      return ctx.prisma.message.findMany({
        where: { roomId: input.roomId },
        orderBy: { createdAt: "asc" },
      });
    }),
}); 