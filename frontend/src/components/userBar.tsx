type UserBarProps = {
  username: string;
};

function UserBar(props: UserBarProps) {
  return (
    <div class="flex flex-row items-center justify-center mt-1.5 w-full">
      <div class="flex items-center py-2 w-[95%] bg-zinc-100 border-solid border-[1px] border-zinc-200 rounded-md">
        <div class="flex rounded-full aspect-square ml-4 mr-3 h-10 bg-zinc-300"></div>
        <span class="font-SpaceGrotesk font-semibold mr-4 text-center text-zinc-900 overflow-auto text-wrap break-words">{props.username}</span>
      </div>
    </div>
  );
}

export default UserBar;
